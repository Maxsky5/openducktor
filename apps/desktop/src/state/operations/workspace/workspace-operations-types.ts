import type { GitBranch, GitCurrentBranch, WorkspaceRecord } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import type { host } from "../shared/host";

export type WorkspaceOperationsHostClient = Pick<
  typeof host,
  | "gitGetBranches"
  | "gitGetCurrentBranch"
  | "gitGetWorktreeStatus"
  | "gitGetWorktreeStatusSummary"
  | "gitSwitchBranch"
  | "runtimeEnsure"
  | "workspaceAdd"
  | "workspaceGetRepoConfig"
  | "workspaceGetSettingsSnapshot"
  | "workspaceList"
  | "workspaceSelect"
>;

export type UseWorkspaceOperationsArgs = {
  activeRepo: string | null;
  setActiveRepo: (repoPath: string | null) => void;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
  hostClient?: WorkspaceOperationsHostClient;
};

export type UseWorkspaceOperationsResult = {
  workspaces: WorkspaceRecord[];
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  branchSyncDegraded: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (repoPath: string) => Promise<void>;
  selectWorkspace: (repoPath: string) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  clearBranchData: () => void;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};

export type PreparedRepoSwitch = {
  previousRepo: string | null;
  nextRepo: string;
};

export type PreparedRepoSwitchRef = MutableRefObject<PreparedRepoSwitch | null>;

export type WorkspaceBranchProbeController = {
  activeRepoRef: MutableRefObject<string | null>;
  lastKnownBranchNameRef: MutableRefObject<string | null>;
  lastKnownDetachedRef: MutableRefObject<boolean | null>;
  lastKnownRevisionRef: MutableRefObject<string | null>;
  refreshBranchesForRepo: (repoPath: string) => Promise<void>;
};
