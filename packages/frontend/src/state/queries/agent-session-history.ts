import type { RuntimeKind, SettingsSnapshot } from "@openducktor/contracts";
import type {
  AgentSessionHistoryMessage,
  AgentSessionScope,
  LoadAgentSessionHistoryInput,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { resolveAgentSessionRuntimePolicy } from "@/state/operations/agent-orchestrator/support/session-runtime-policy";
import { toRuntimeSessionRefWithPolicy } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  sessionHistoryCoverage,
  type SessionHistoryVersion,
} from "./agent-session-history-coverage";

export const SESSION_HISTORY_STALE_TIME_MS = Number.POSITIVE_INFINITY;
const historyVersions = new WeakMap<AgentSessionHistoryMessage[], SessionHistoryVersion | null>();

export const agentSessionHistoryQueryKeys = {
  all: ["agent-session-history"] as const,
  workspace: (repoPath: string) =>
    ["agent-session-history", normalizeWorkingDirectory(repoPath)] as const,
  history: ({
    repoPath,
    runtimeKind,
    workingDirectory,
    externalSessionId,
    sessionScope,
    limit,
    systemPromptContext,
    systemPrompt,
    model,
    runtimePolicy,
  }: LoadAgentSessionHistoryInput) =>
    [
      ...agentSessionHistoryQueryKeys.workspace(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      externalSessionId,
      { sessionScope, limit, systemPromptContext, systemPrompt, model, runtimePolicy },
    ] as const,
  /** True for a history key of this runtime kind in any workspace or directory. */
  matchesRuntimeKind: (key: QueryKey, runtimeKind: RuntimeKind): boolean =>
    key[0] === agentSessionHistoryQueryKeys.all[0] && key[2] === runtimeKind,
};

type RuntimeSessionHistoryRefInput = AgentSessionIdentity & {
  repoPath: string;
  sessionScope: AgentSessionScope | null;
};

export const runtimeSessionHistoryRefQueryOptions = (
  input: RuntimeSessionHistoryRefInput,
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>,
) =>
  queryOptions<PolicyBoundSessionRef, Error, PolicyBoundSessionRef, QueryKey>({
    queryKey: [
      "runtime-session-history-ref",
      normalizeWorkingDirectory(input.repoPath),
      input.runtimeKind,
      normalizeWorkingDirectory(input.workingDirectory),
      input.externalSessionId,
      input.sessionScope,
    ],
    queryFn: async () => {
      const runtimePolicy = await resolveAgentSessionRuntimePolicy({
        runtimeKind: input.runtimeKind,
        sessionScope: input.sessionScope,
        loadSettingsSnapshot,
      });
      const sessionRef: PolicyBoundSessionRef = {
        ...toRuntimeSessionRefWithPolicy(input.repoPath, input, runtimePolicy),
      };
      if (input.sessionScope) {
        sessionRef.sessionScope = input.sessionScope;
      }
      return sessionRef;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

export const sessionHistoryQueryOptions = (
  session: LoadAgentSessionHistoryInput,
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ) => Promise<AgentSessionHistoryMessage[]>,
  queryClient: QueryClient,
) =>
  queryOptions<AgentSessionHistoryMessage[], Error, AgentSessionHistoryMessage[], QueryKey>({
    queryKey: agentSessionHistoryQueryKeys.history(session),
    queryFn: async (): Promise<AgentSessionHistoryMessage[]> => {
      const version = sessionHistoryCoverage(queryClient).read(session.repoPath, session);
      const history = await readSessionHistory(session);
      historyVersions.set(history, version);
      return history;
    },
    // Keep the response identity with its coverage token, including a cold read raced by events.
    structuralSharing: false,
    staleTime: (query) =>
      sessionHistoryCoverage(queryClient).isCurrent(
        session.repoPath,
        session,
        query.state.data ? (historyVersions.get(query.state.data) ?? null) : null,
      )
        ? SESSION_HISTORY_STALE_TIME_MS
        : 0,
    refetchOnWindowFocus: false,
  });
