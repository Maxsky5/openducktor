export type TaskReadLoadingState = {
  hasCurrentTaskSnapshot: boolean;
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
  isTaskQuerySuccessForActiveRepo: boolean;
};

export const getTaskReadLoadingState = ({
  activeRepoPath,
  isManualLoadingTasks,
  isSettingsLoadingForActiveRepo,
  isTaskQueryLoadingForActiveRepo,
  isTaskQueryFetchingForActiveRepo,
  isTaskQuerySuccessForActiveRepo,
}: TaskReadLoadingStateInput): TaskReadLoadingState => {
  const hasActiveRepo = activeRepoPath !== null;
  const isForegroundLoadingTasks =
    hasActiveRepo &&
    (isManualLoadingTasks || isSettingsLoadingForActiveRepo || isTaskQueryLoadingForActiveRepo);
  const isRefreshingTasksInBackground =
    hasActiveRepo && isTaskQueryFetchingForActiveRepo && !isForegroundLoadingTasks;
  const hasCurrentTaskSnapshot =
    hasActiveRepo &&
    isTaskQuerySuccessForActiveRepo &&
    !isForegroundLoadingTasks &&
    !isTaskQueryFetchingForActiveRepo;

  return {
    hasCurrentTaskSnapshot,
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    isLoadingTasks: isForegroundLoadingTasks,
  };
};
