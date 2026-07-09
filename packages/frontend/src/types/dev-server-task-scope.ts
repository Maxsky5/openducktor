export type DevServerTaskScope = {
  repoPath: string;
  taskId: string;
};

export const MISSING_DEV_SERVER_TASK_SCOPE_MESSAGE =
  "Builder dev servers require an active repository and task.";

const EMPTY_DEV_SERVER_TASK_SCOPE_KEY = "__no-dev-server-task__";

export const createDevServerTaskScope = (
  repoPath: string | null,
  taskId: string | null,
): DevServerTaskScope | null => {
  if (!repoPath || !taskId) {
    return null;
  }

  return { repoPath, taskId };
};

export const formatDevServerTaskScopeKey = (scope: DevServerTaskScope | null): string => {
  if (!scope) {
    return EMPTY_DEV_SERVER_TASK_SCOPE_KEY;
  }

  return JSON.stringify([scope.repoPath, scope.taskId]);
};

export const formatDevServerTerminalIdentityKey = (scopeKey: string, scriptId: string): string =>
  JSON.stringify([scopeKey, scriptId]);

export const isSameDevServerTaskScope = (
  left: DevServerTaskScope | null,
  right: DevServerTaskScope | null,
): boolean => {
  return (
    left !== null &&
    right !== null &&
    left.repoPath === right.repoPath &&
    left.taskId === right.taskId
  );
};
