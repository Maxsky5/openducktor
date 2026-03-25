import { queryOptions, useQuery } from "@tanstack/react-query";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
  }) => Promise<void>;
};

type UseAgentStudioTaskHydrationResult = {
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isActiveSessionHistoryHydrated: boolean;
  isActiveSessionHistoryHydrationFailed: boolean;
  isActiveSessionHistoryHydrating: boolean;
};

const sessionHistoryHydrationQueryOptions = (
  repoPath: string,
  taskId: string,
  sessionId: string,
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
  }) => Promise<void>,
) =>
  queryOptions({
    queryKey: ["agent-session-history-hydration", repoPath, taskId, sessionId] as const,
    queryFn: (): Promise<null> =>
      hydrateRequestedTaskSessionHistory({
        taskId,
        sessionId,
      }).then(() => null),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

export function useAgentStudioTaskHydration({
  activeRepo,
  activeTaskId,
  activeSession,
  hydrateRequestedTaskSessionHistory,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const activeSessionId = activeSession?.sessionId ?? null;
  const activeRepoPath = activeRepo ?? "";
  const shouldHydrateSessionHistory =
    Boolean(activeRepo && activeTaskId && activeSessionId) &&
    !(
      activeSession &&
      activeSession.status !== "stopped" &&
      activeSession.runtimeEndpoint.trim().length > 0 &&
      activeSession.messages.length > 0
    );
  const sessionHistoryHydrationQuery = useQuery({
    queryKey:
      shouldHydrateSessionHistory && activeSessionId
        ? sessionHistoryHydrationQueryOptions(
            activeRepoPath,
            activeTaskId,
            activeSessionId,
            hydrateRequestedTaskSessionHistory,
          ).queryKey
        : (["agent-session-history-hydration", "", "", ""] as const),
    queryFn: async (): Promise<null> => {
      if (!activeRepo || !activeTaskId || !activeSessionId) {
        return null;
      }
      await hydrateRequestedTaskSessionHistory({
        taskId: activeTaskId,
        sessionId: activeSessionId,
      });
      return null;
    },
    enabled: shouldHydrateSessionHistory,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  return {
    isActiveTaskHydrated: Boolean(activeRepo && activeTaskId),
    isActiveTaskHydrationFailed: false,
    isActiveSessionHistoryHydrated: activeSessionId
      ? shouldHydrateSessionHistory
        ? sessionHistoryHydrationQuery.isSuccess
        : true
      : false,
    isActiveSessionHistoryHydrationFailed: activeSessionId
      ? shouldHydrateSessionHistory
        ? sessionHistoryHydrationQuery.isError
        : false
      : false,
    isActiveSessionHistoryHydrating: activeSessionId
      ? shouldHydrateSessionHistory
        ? sessionHistoryHydrationQuery.isPending
        : false
      : false,
  };
}
