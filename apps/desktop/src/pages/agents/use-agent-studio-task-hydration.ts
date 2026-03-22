import { queryOptions, useQuery } from "@tanstack/react-query";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSessionId: string | null;
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
  activeSessionId,
  hydrateRequestedTaskSessionHistory,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const sessionHistoryHydrationQuery = useQuery({
    queryKey:
      activeRepo && activeTaskId && activeSessionId
        ? sessionHistoryHydrationQueryOptions(
            activeRepo,
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
    enabled: Boolean(activeRepo && activeTaskId && activeSessionId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  return {
    isActiveTaskHydrated: Boolean(activeRepo && activeTaskId),
    isActiveTaskHydrationFailed: false,
    isActiveSessionHistoryHydrated: activeSessionId
      ? sessionHistoryHydrationQuery.isSuccess
      : false,
    isActiveSessionHistoryHydrationFailed: activeSessionId
      ? sessionHistoryHydrationQuery.isError
      : false,
    isActiveSessionHistoryHydrating: activeSessionId
      ? sessionHistoryHydrationQuery.isPending
      : false,
  };
}
