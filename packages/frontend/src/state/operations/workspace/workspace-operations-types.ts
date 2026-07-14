import type { GitBranch, GitCurrentBranch, WorkspaceRecord } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import type { WorkspaceSelectionOperationsInput } from "@/types/state-slices";
import type { host } from "../shared/host";

export type WorkspaceBranchOperationsHostClient = Pick<
  typeof host,
  "gitGetBranches" | "gitGetCurrentBranch" | "gitSwitchBranch"
>;

export type WorkspaceBranchProbeHostClient = Pick<typeof host, "gitGetCurrentBranch">;

export type WorkspaceSelectionOperationsHostClient = Pick<
  typeof host,
  "workspaceAdd" | "workspaceList" | "workspaceReorder" | "workspaceSelect"
>;

export type WorkspaceOperationsHostClient = WorkspaceBranchOperationsHostClient &
  WorkspaceSelectionOperationsHostClient;

export type UseWorkspaceOperationsResult = {
  workspaces: WorkspaceRecord[];
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  branchSyncDegraded: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  reorderWorkspaces: (workspaceIds: string[]) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  clearBranchData: () => void;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};

export type WorkspaceBranchProbeController = {
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  lastKnownBranchNameRef: MutableRefObject<string | null>;
  lastKnownDetachedRef: MutableRefObject<boolean | null>;
  lastKnownRevisionRef: MutableRefObject<string | null>;
  refreshBranchesForRepo: (repoPath: string) => Promise<void>;
};
