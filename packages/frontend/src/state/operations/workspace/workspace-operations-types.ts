import type {
  GitBranch,
  GitCurrentBranch,
  IncompleteWorkspaceRemoval,
  WorkspacePathResolution,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type {
  WorkspaceLifecycleTarget,
  WorkspaceRemovalInput,
  WorkspaceSelectionOperationsInput,
} from "@/types/state-slices";
import type { host } from "../shared/host";

export type WorkspaceBranchOperationsHostClient = Pick<
  typeof host,
  "gitGetBranches" | "gitGetCurrentBranch" | "gitSwitchBranch"
>;

export type WorkspaceBranchProbeHostClient = Pick<
  typeof host,
  "gitGetBranches" | "gitGetCurrentBranch"
>;

export type WorkspaceSelectionOperationsHostClient = Pick<
  typeof host,
  | "workspaceAdd"
  | "workspaceCatalogGet"
  | "workspaceClose"
  | "workspaceList"
  | "workspaceRemove"
  | "workspaceReopen"
  | "workspaceReorder"
  | "workspaceResolvePath"
  | "workspaceSelect"
>;

export type WorkspaceOperationsHostClient = WorkspaceBranchOperationsHostClient &
  WorkspaceSelectionOperationsHostClient;

export type UseWorkspaceOperationsResult = {
  workspaces: WorkspaceRecord[];
  closedWorkspaces: WorkspaceRecord[];
  incompleteRemovals: IncompleteWorkspaceRemoval[];
  onboardingCompleted: boolean;
  hasLoadedWorkspaceList: boolean;
  isLoadingWorkspaces: boolean;
  workspaceLoadError: Error | null;
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  branchSyncDegraded: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  closeWorkspace: (input: WorkspaceLifecycleTarget) => Promise<void>;
  removeWorkspace: (input: WorkspaceRemovalInput) => Promise<void>;
  reopenWorkspace: (input: WorkspaceLifecycleTarget) => Promise<void>;
  resolveWorkspacePath: (repoPath: string) => Promise<WorkspacePathResolution>;
  reorderWorkspaces: (workspaceIds: string[]) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  clearBranchData: (repoPath?: string | null) => void;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};
