import type { SettingsSnapshot } from "@openducktor/contracts";
import type {
  AgentSessionHistoryMessage,
  AgentSessionScope,
  LoadAgentSessionHistoryInput,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { resolveAgentSessionRuntimePolicy } from "@/state/operations/agent-orchestrator/support/session-runtime-policy";
import { toRuntimeSessionRefWithPolicy } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export const SESSION_HISTORY_STALE_TIME_MS = 0;

export const agentSessionHistoryQueryKeys = {
  all: ["agent-session-history"] as const,
  history: ({
    repoPath,
    runtimeKind,
    workingDirectory,
    externalSessionId,
  }: LoadAgentSessionHistoryInput) =>
    [
      ...agentSessionHistoryQueryKeys.all,
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      externalSessionId,
    ] as const,
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
      input.sessionScope?.taskId ?? null,
      input.sessionScope?.role ?? null,
    ],
    queryFn: async () => {
      const runtimePolicy = await resolveAgentSessionRuntimePolicy({
        runtimeKind: input.runtimeKind,
        sessionScope: input.sessionScope,
        loadSettingsSnapshot,
      });
      return {
        ...toRuntimeSessionRefWithPolicy(input.repoPath, input, runtimePolicy),
        ...(input.sessionScope ? { sessionScope: input.sessionScope } : {}),
      };
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

export const sessionHistoryQueryOptions = (
  session: LoadAgentSessionHistoryInput,
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ) => Promise<AgentSessionHistoryMessage[]>,
) =>
  queryOptions<AgentSessionHistoryMessage[], Error, AgentSessionHistoryMessage[], QueryKey>({
    queryKey: agentSessionHistoryQueryKeys.history(session),
    queryFn: (): Promise<AgentSessionHistoryMessage[]> => readSessionHistory(session),
    staleTime: SESSION_HISTORY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
