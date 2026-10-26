export type TaskReadLoadingState = {
  tasksAreCurrent: boolean;
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
  const tasksAreCurrent =
    hasActiveRepo &&
    isTaskQuerySuccessForActiveRepo &&
    !isForegroundLoadingTasks &&
    !isTaskQueryFetchingForActiveRepo;

  return {
    tasksAreCurrent,
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    isLoadingTasks: isForegroundLoadingTasks,
  };
};
