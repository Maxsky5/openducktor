export type TaskReadLoadingState = {
  isForegroundLoadingTasks: boolean;
  isRefreshingTasksInBackground: boolean;
  isLoadingTasks: boolean;
};

type TaskReadLoadingStateInput = {
  activeRepoPath: string | null;
  isManualLoadingTasks: boolean;
  isSettingsLoadingForActiveRepo: boolean;
  isTaskQueryLoadingForActiveRepo: boolean;
  isTaskQueryFetchingForActiveRepo: boolean;
};

export const getTaskReadLoadingState = ({
  activeRepoPath,
  isManualLoadingTasks,
  isSettingsLoadingForActiveRepo,
  isTaskQueryLoadingForActiveRepo,
  isTaskQueryFetchingForActiveRepo,
}: TaskReadLoadingStateInput): TaskReadLoadingState => {
  const hasActiveRepo = activeRepoPath !== null;
  const isForegroundLoadingTasks =
    hasActiveRepo &&
    (isManualLoadingTasks || isSettingsLoadingForActiveRepo || isTaskQueryLoadingForActiveRepo);
  const isRefreshingTasksInBackground =
    hasActiveRepo && isTaskQueryFetchingForActiveRepo && !isForegroundLoadingTasks;

  return {
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    isLoadingTasks: isForegroundLoadingTasks,
  };
};
