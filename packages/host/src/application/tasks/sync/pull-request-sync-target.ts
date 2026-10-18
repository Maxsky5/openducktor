import type { WorkspaceCatalog } from "@openducktor/contracts";
import type { RepoPullRequestSyncResult } from "../task-service";

export const workspaceSyncSkip = (
  catalog: WorkspaceCatalog,
  repoPath: string,
  workspaceId: string,
): Extract<RepoPullRequestSyncResult, { ran: false }> | null => {
  if (catalog.incompleteRemovals.some(({ workspace }) => workspace.workspaceId === workspaceId)) {
    return {
      ran: false,
      changedTaskIds: [],
      reason: "workspace_unavailable",
      message: "Workspace removal is incomplete. Finish removal from the workspace rail.",
    };
  }
  const workspace = [...catalog.openWorkspaces, ...catalog.closedWorkspaces].find(
    (entry) => entry.workspaceId === workspaceId,
  );
  if (!workspace || workspace.repoPath !== repoPath) {
    return {
      ran: false,
      changedTaskIds: [],
      reason: "workspace_unavailable",
      message: workspace
        ? "The workspace repository path changed after you chose the sync scope. Choose the scope again to use its current path."
        : "The workspace is no longer registered. Open the workspace before syncing pull requests.",
    };
  }
  if (catalog.closedWorkspaces.some((entry) => entry.workspaceId === workspaceId)) {
    return {
      ran: false,
      changedTaskIds: [],
      reason: "workspace_closed",
      message: "The workspace closed before sync started. Reopen it before syncing pull requests.",
    };
  }
  return null;
};
