import { type DevServerOwner, formatDevServerOwnerKey } from "@openducktor/contracts";

export type DevServerScope = {
  repoPath: string;
  owner: DevServerOwner;
};

export const MISSING_DEV_SERVER_SCOPE_MESSAGE =
  "Dev servers require an active repository and owner.";

const EMPTY_DEV_SERVER_SCOPE_KEY = "__no-dev-server-owner__";

export const createDevServerScope = (
  repoPath: string | null,
  owner: DevServerOwner | null,
): DevServerScope | null => {
  if (!repoPath || !owner) {
    return null;
  }

  return { repoPath, owner };
};

export const formatDevServerScopeKey = (scope: DevServerScope | null): string => {
  if (!scope) {
    return EMPTY_DEV_SERVER_SCOPE_KEY;
  }

  return JSON.stringify([scope.repoPath, formatDevServerOwnerKey(scope.owner)]);
};

export const formatDevServerTerminalIdentityKey = (scopeKey: string, scriptId: string): string =>
  JSON.stringify([scopeKey, scriptId]);

export const isSameDevServerOwner = (left: DevServerOwner, right: DevServerOwner): boolean =>
  left.kind === right.kind &&
  (left.kind === "task"
    ? right.kind === "task" && left.taskId === right.taskId
    : right.kind === "workspace_session" &&
      left.workspaceId === right.workspaceId &&
      left.sessionId === right.sessionId);

export const isSameDevServerScope = (
  left: DevServerScope | null,
  right: DevServerScope | null,
): boolean => {
  return (
    left !== null &&
    right !== null &&
    left.repoPath === right.repoPath &&
    isSameDevServerOwner(left.owner, right.owner)
  );
};
