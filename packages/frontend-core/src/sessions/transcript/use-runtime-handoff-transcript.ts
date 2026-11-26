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
const collectHistoryReads = <Data>(
  results: readonly { data: Data | undefined; error: Error | null }[],
) => results.map(({ data, error }) => ({ data, error }));

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
    combine: (results) =>
      segments.map((link, index) => ({
        link,
        ref: results[index]?.data,
        error: results[index]?.error,
      })),
  });
  const readyRefs = useMemo(() => refs.flatMap(({ ref }) => (ref ? [ref] : [])), [refs]);
  const history = useQueries({
    queries: readyRefs.map((ref) =>
      sessionHistoryQueryOptions(ref, readSessionHistory, queryClient),
    ),
    combine: collectHistoryReads,
  });
  const activeMessages = session?.messages;
  const timestamp = activeMessages?.items[0]?.timestamp ?? "1970-01-01T00:00:00.000Z";
  const earlierSegments = useMemo(() => {
    if (!refs.length) return null;
    const items: AgentChatMessage[] = [];
    let version = 0;
    const available = new Map(
      readyRefs.map((ref, index) => [agentSessionIdentityKey(ref), history[index]]),
    );
    for (const { link, ref, error: refError } of refs) {
      const segmentKey = agentSessionIdentityKey(link.from);
      const read = available.get(segmentKey);
      const error = refError ?? read?.error;
      const source = RUNTIME_DESCRIPTORS_BY_KIND[link.from.runtimeKind].label;
      const destination = RUNTIME_DESCRIPTORS_BY_KIND[link.to.runtimeKind].label;
      const contextNote = link.partialHistory ? "Some earlier context was omitted." : undefined;
      if (read?.data) {
        const earlier = createReadonlyTranscriptSession({
          ...link.from,
          history: read.data,
          sessionScope: ref?.sessionScope ?? null,
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
            item.meta = {
              ...item.meta,
              sourceSession: { ...link.from, sessionScope: ref?.sessionScope ?? null },
            };
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
        content: `${source} to ${destination}${contextNote ? `. ${contextNote}` : ""}`,
        timestamp,
        timestampIsApproximate: true,
        meta: {
          kind: "session_notice",
          tone: "info",
          reason: "runtime_handoff",
          title: "Handoff",
          direction: { from: link.from.runtimeKind, to: link.to.runtimeKind },
          contextNote,
        },
      });
    }
    return { items, version };
  }, [history, readyRefs, refs, repoPath, timestamp]);
  const messages = useMemo(() => {
    if (!earlierSegments || !activeMessages) return null;
    return createSessionMessagesState(
      activeMessages.externalSessionId,
      [...earlierSegments.items, ...activeMessages.items],
      earlierSegments.version + activeMessages.version,
    );
  }, [activeMessages, earlierSegments]);
  return useMemo<AgentChatTranscriptSession | null>(
    () =>
      session && messages ? { ...session, hasEarlierHandoffSegments: true, messages } : session,
    [messages, session],
  );
};
