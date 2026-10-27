import type { WorkspaceRecord } from "@openducktor/contracts";

/** One workspace that a manual action from the palette runs for. */
export type WorkspaceScopeTarget = Pick<
  WorkspaceRecord,
  "workspaceId" | "workspaceName" | "repoPath"
>;

/** A palette action that first asks for its workspaces. */
export type WorkspaceScopeAction = "pull_request_sync" | "merge_check";

/** The workspaces of one manual run: the named workspace, or all open workspaces. */
export type WorkspaceScope = {
  kind: "workspace" | "all";
  label: string;
  targets: readonly WorkspaceScopeTarget[];
};
