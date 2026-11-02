/**
 * The workspace lifecycle states that one durable operation accepts.
 * - `open`: an open workspace without an incomplete removal.
 * - `ownership`: also a closed workspace, because its records return when it reopens.
 * - `administrative`: every registered workspace, for lifecycle work and the reads that removal needs.
 */
export type WorkspaceAccess = "open" | "ownership" | "administrative";

type WorkspaceLifecycleState = { closed: boolean; removal: boolean };

/**
 * The one workspace lifecycle policy. Stores apply it in the transaction of each operation.
 * Process starts apply it to the current catalog. Returns the user message when it blocks access.
 */
export const workspaceAccessBlock = (
  workspaceId: string,
  state: WorkspaceLifecycleState,
  access: WorkspaceAccess,
): string | null => {
  if (access === "administrative") return null;
  if (state.removal)
    return `Workspace removal is incomplete for ${workspaceId}. Retry removal before accessing this workspace.`;
  if (state.closed && access === "open")
    return `Workspace is closed: ${workspaceId}. Reopen it before using it.`;
  return null;
};
