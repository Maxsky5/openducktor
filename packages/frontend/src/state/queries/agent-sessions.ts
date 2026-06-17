import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { host } from "../operations/host";

const AGENT_SESSION_LIST_STALE_TIME_MS = 30_000;

export const agentSessionQueryKeys = {
  all: ["agent-sessions"] as const,
  list: (repoPath: string, taskId: string) =>
    [...agentSessionQueryKeys.all, "list", repoPath, taskId] as const,
};

export const agentSessionListQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: (): Promise<AgentSessionRecord[]> => host.agentSessionsList(repoPath, taskId),
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });

export const loadAgentSessionListFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  options?: {
    forceFresh?: boolean;
  },
): Promise<AgentSessionRecord[]> =>
  queryClient.fetchQuery({
    ...agentSessionListQueryOptions(repoPath, taskId),
    ...(options?.forceFresh ? { staleTime: 0 } : {}),
  });

export const loadAgentSessionListsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  options?: {
    forceFresh?: boolean;
  },
): Promise<Record<string, AgentSessionRecord[]>> => {
  const uniqueTaskIds = Array.from(new Set(taskIds));
  const entries = await Promise.all(
    uniqueTaskIds.map(async (taskId) => {
      const records = await loadAgentSessionListFromQuery(queryClient, repoPath, taskId, options);
      return [taskId, records] as const;
    }),
  );

  return Object.fromEntries(entries);
};

const areSelectedModelsEquivalent = (
  left: AgentSessionRecord["selectedModel"],
  right: AgentSessionRecord["selectedModel"],
): boolean => {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return (
    left.runtimeKind === right.runtimeKind &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.variant === right.variant &&
    left.profileId === right.profileId
  );
};

const areAgentSessionRecordsEquivalent = (
  left: AgentSessionRecord,
  right: AgentSessionRecord,
): boolean =>
  left.externalSessionId === right.externalSessionId &&
  left.role === right.role &&
  left.startedAt === right.startedAt &&
  left.runtimeKind === right.runtimeKind &&
  left.workingDirectory === right.workingDirectory &&
  areSelectedModelsEquivalent(left.selectedModel, right.selectedModel);

export const upsertAgentSessionRecordInQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  session: AgentSessionRecord,
): void => {
  queryClient.setQueryData<AgentSessionRecord[] | undefined>(
    agentSessionQueryKeys.list(repoPath, taskId),
    (current): AgentSessionRecord[] | undefined => {
      if (!current) {
        return current;
      }

      const sessionKey = agentSessionIdentityKey(session);
      const existingIndex = current.findIndex(
        (entry) => agentSessionIdentityKey(entry) === sessionKey,
      );
      if (existingIndex === -1) {
        return [...current, session];
      }

      const existingSession = current[existingIndex];
      if (!existingSession || existingSession === session) {
        return current;
      }

      if (areAgentSessionRecordsEquivalent(existingSession, session)) {
        return current;
      }

      return current.map((entry, index) => (index === existingIndex ? session : entry));
    },
  );
};
