import type { GitBranch, GitCurrentBranch, WorkspaceRecord } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import type { ActiveWorkspace, WorkspaceSelectionOperationsInput } from "@/types/state-slices";
import type { host } from "../shared/host";

export type WorkspaceBranchOperationsHostClient = Pick<
  typeof host,
  "gitGetBranches" | "gitGetCurrentBranch" | "gitSwitchBranch"
>;

export type WorkspaceBranchProbeHostClient = Pick<typeof host, "gitGetCurrentBranch">;

export type WorkspaceSelectionOperationsHostClient = Pick<
  typeof host,
  "runtimeEnsure" | "workspaceAdd" | "workspaceGetRepoConfig" | "workspaceList" | "workspaceSelect"
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
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  activeWorkspaceRef?: MutableRefObject<ActiveWorkspace | null>;
  lastKnownBranchNameRef: MutableRefObject<string | null>;
  lastKnownDetachedRef: MutableRefObject<boolean | null>;
  lastKnownRevisionRef: MutableRefObject<string | null>;
  refreshBranchesForRepo: (repoPath: string) => Promise<void>;
};
