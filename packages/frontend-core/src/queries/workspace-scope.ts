import { type WorkspaceRef, workspaceRefSchema } from "@openducktor/contracts";
import type { Query } from "@tanstack/react-query";

export const workspaceScopeKey = ({ workspaceId, repoPath }: WorkspaceRef): string =>
  JSON.stringify([workspaceId, repoPath]);

export const workspaceScopeValue = ({ workspaceId, repoPath }: WorkspaceRef): WorkspaceRef => ({
  workspaceId,
  repoPath,
});

export const queryWorkspaceScope = (query: Pick<Query, "queryKey">): WorkspaceRef | null => {
  const result = workspaceRefSchema.safeParse(query.queryKey[2]);
  return result.success ? result.data : null;
};

export const queryMatchesWorkspace = (
  query: Pick<Query, "queryKey">,
  scope: WorkspaceRef,
): boolean => {
  const saved = queryWorkspaceScope(query);
  return (
    saved !== null && saved.workspaceId === scope.workspaceId && saved.repoPath === scope.repoPath
  );
};
