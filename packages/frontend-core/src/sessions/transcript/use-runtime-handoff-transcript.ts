import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionScope,
  type HandoffLink,
} from "@openducktor/contracts";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  agentSessionIdentityKey,
  matchesAgentSessionIdentity,
} from "../../lib/agent-session-identity";
import {
  runtimeSessionHistoryRefQueryOptions,
  sessionHistoryQueryOptions,
} from "../../queries/agent-session-history";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";
import { useAgentOperationsContext } from "../session-contexts";
import { createReadonlyTranscriptSession } from "../readonly-transcript/readonly-transcript-session";
import { buildSessionErrorNoticeMessage } from "../agent-orchestrator/support/session-notice-messages";
import { createSessionMessagesState } from "../agent-orchestrator/support/messages";
import type { AgentChatMessage } from "../../types/agent-orchestrator";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";

const NO_LINKS: readonly HandoffLink[] = [];

/** Adds the earlier native segments to the live projection of the active member. */
export const useRuntimeHandoffTranscript = ({
  session,
  repoPath,
  scope,
  links,
}: {
  session: AgentChatTranscriptSession | null;
  repoPath: string | null;
  scope: AgentSessionScope | null;
  links: readonly HandoffLink[] | undefined;
}) => {
  const queryClient = useQueryClient();
  const { readSessionHistory } = useAgentOperationsContext();
  const last = links?.at(-1);
  const segments =
    session && last && matchesAgentSessionIdentity(session, last.to)
      ? (links ?? NO_LINKS)
      : NO_LINKS;
  const refs = useQueries({
    queries:
      repoPath && scope
        ? segments.map(({ from }) =>
            runtimeSessionHistoryRefQueryOptions({ ...from, repoPath, sessionScope: scope }, () =>
              queryClient.ensureQueryData(settingsSnapshotQueryOptions()),
            ),
          )
        : [],
  });
  const readyRefs = refs.flatMap(({ data }) => (data ? [data] : []));
  const history = useQueries({
    queries: readyRefs.map((ref) =>
      sessionHistoryQueryOptions(ref, readSessionHistory, queryClient),
    ),
  });
  return useMemo(() => {
    if (!session || !segments.length) return session;
    const items: AgentChatMessage[] = [];
    let version = session.messages.version;
    const available = new Map(
      readyRefs.map((ref, index) => [agentSessionIdentityKey(ref), history[index]]),
    );
    const timestamp = session.messages.items[0]?.timestamp ?? new Date(0).toISOString();
    for (const [index, link] of segments.entries()) {
      const segmentKey = agentSessionIdentityKey(link.from);
      const read = available.get(segmentKey);
      const error = refs[index]?.error ?? read?.error;
      const source = RUNTIME_DESCRIPTORS_BY_KIND[link.from.runtimeKind].label;
      const destination = RUNTIME_DESCRIPTORS_BY_KIND[link.to.runtimeKind].label;
      if (read?.data) {
        const earlier = createReadonlyTranscriptSession({
          ...link.from,
          history: read.data,
          sessionScope: scope,
        });
        version += earlier.messages.version;
        for (const message of earlier.messages.items) {
          const item = {
            ...message,
            id: `${segmentKey}:${message.id}`,
            sourceRuntimeKind: link.from.runtimeKind,
          };
          if (item.meta?.kind === "assistant" && item.meta.forkPoint) {
            item.meta = { ...item.meta };
            delete item.meta.forkPoint;
          } else if (item.meta?.kind === "tool") {
            item.meta = { ...item.meta, sourceSession: link.from };
          } else if (item.meta?.kind === "subagent") {
            item.meta = { ...item.meta, sourceSession: { ...link.from, sessionScope: scope } };
          } else if (item.meta?.kind === "image_generation" && repoPath) {
            item.meta = { ...item.meta, sourceSession: { ...link.from, repoPath } };
          }
          items.push(item);
        }
      } else if (error) {
        items.push(
          buildSessionErrorNoticeMessage(
            timestamp,
            `Could not load earlier ${source} history. ${error.message}`,
            `${segmentKey}:history-error`,
          ),
        );
        version++;
      }
      items.push({
        id: `runtime-handoff:${segmentKey}`,
        role: "system",
        content: `${source} to ${destination}${link.partialHistory ? ". Some earlier context was omitted." : ""}`,
        timestamp,
        timestampIsApproximate: true,
        meta: {
          kind: "session_notice",
          tone: "info",
          reason: "runtime_handoff",
          title: "Runtime handoff",
        },
      });
    }
    return {
      ...session,
      hasEarlierHandoffSegments: true as const,
      messages: createSessionMessagesState(
        session.externalSessionId,
        [...items, ...session.messages.items],
        version,
      ),
    };
  }, [history, readyRefs, refs, repoPath, scope, segments, session]);
};
