import type { SettingsSnapshot } from "@openducktor/contracts";

export type SettingsWorkspaceSelectionPolicy =
  | { kind: "preferred"; repoPath: string | null }
  | { kind: "required"; repoPath: string | null };

export const chooseInitialSettingsWorkspaceId = (
  snapshot: SettingsSnapshot,
  policy: SettingsWorkspaceSelectionPolicy,
): string | null => {
  const workspaceIds = Object.keys(snapshot.workspaces).sort();
  if (policy.repoPath) {
    const matchingWorkspaceId = Object.entries(snapshot.workspaces).find(
      ([, workspace]) => workspace.repoPath === policy.repoPath,
    )?.[0];
    if (matchingWorkspaceId) {
      return matchingWorkspaceId;
    }
  }

  if (policy.kind === "required") {
    return null;
  }

  return workspaceIds[0] ?? null;
};
