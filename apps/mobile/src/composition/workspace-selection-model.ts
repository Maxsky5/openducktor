import type { WorkspaceRecord } from "@openducktor/contracts";

export type WorkspaceSelection = {
  workspace: WorkspaceRecord | null;
  /** Set when the stored choice is no longer open, so the app tells the user why it changed. */
  replaced: { previousWorkspaceId: string } | null;
};

/**
 * Picks the workspace that this app shows. The choice is local to the device and the saved host.
 * Without a stored choice, the app starts at the workspace that the host lists as active.
 */
export const resolveWorkspaceSelection = (
  storedWorkspaceId: string | null,
  workspaces: readonly WorkspaceRecord[],
): WorkspaceSelection => {
  if (storedWorkspaceId) {
    const stored = workspaces.find((workspace) => workspace.workspaceId === storedWorkspaceId);
    if (stored) return { workspace: stored, replaced: null };
    return {
      workspace: workspaces[0] ?? null,
      replaced: { previousWorkspaceId: storedWorkspaceId },
    };
  }
  const hostActive = workspaces.find((workspace) => workspace.isActive);
  return { workspace: hostActive ?? workspaces[0] ?? null, replaced: null };
};
