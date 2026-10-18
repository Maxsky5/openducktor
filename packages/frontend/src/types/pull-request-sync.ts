import type { WorkspaceRecord } from "@openducktor/contracts";

export type PullRequestSyncTarget = Pick<
  WorkspaceRecord,
  "workspaceId" | "workspaceName" | "repoPath"
>;

export type PullRequestSyncScope = {
  kind: "workspace" | "all";
  label: string;
  targets: readonly PullRequestSyncTarget[];
};
