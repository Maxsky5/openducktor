import type { WorkspaceRef } from "@openducktor/contracts";

export const workspaceRefFixture = (
  repoPath: string,
  workspaceId = "workspace-1",
): WorkspaceRef => ({
  workspaceId,
  repoPath,
});
