import type { SettingsSnapshot } from "@openducktor/contracts";

export const pickInitialWorkspaceId = (
  snapshot: SettingsSnapshot,
  workspaceRepoPath: string | null,
): string | null => {
  const workspaceIds = Object.keys(snapshot.workspaces).sort();
  if (workspaceRepoPath) {
    const matchingWorkspaceId = Object.entries(snapshot.workspaces).find(
      ([, workspace]) => workspace.repoPath === workspaceRepoPath,
    )?.[0];
    if (matchingWorkspaceId) {
      return matchingWorkspaceId;
    }
  }
  return workspaceIds[0] ?? null;
};
