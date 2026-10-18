import type {
  GitBranch,
  GitCurrentBranch,
  IncompleteWorkspaceRemoval,
  WorkspaceLifecycleTargetInput,
  WorkspacePathResolution,
  WorkspaceRecord,
  WorkspaceRemovalInput,
  WorkspaceProviderSetupCommit,
  WorkspaceProviderSetupProgress,
} from "@openducktor/contracts";
import type { WorkspaceSelectionOperationsInput } from "@/types/state-slices";

export type UseWorkspaceOperationsResult = {
  workspaces: WorkspaceRecord[];
  closedWorkspaces: WorkspaceRecord[];
  incompleteRemovals: IncompleteWorkspaceRemoval[];
  hasLoadedWorkspaceList: boolean;
  /** True when the open and closed workspace lists both loaded and neither list is fetching. */
  workspaceRecordsAreCurrent: boolean;
  isLoadingWorkspaces: boolean;
  workspaceLoadError: Error | null;
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  branchSyncDegraded: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<WorkspaceRecord>;
  commitWorkspaceProviderSetup: (
    input: WorkspaceProviderSetupCommit,
  ) => Promise<WorkspaceProviderSetupProgress>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  closeWorkspace: (input: WorkspaceLifecycleTargetInput) => Promise<void>;
  removeWorkspace: (input: WorkspaceRemovalInput) => Promise<void>;
  reopenWorkspace: (input: WorkspaceLifecycleTargetInput) => Promise<void>;
  resolveWorkspacePath: (repoPath: string) => Promise<WorkspacePathResolution>;
  reorderWorkspaces: (workspaceIds: string[]) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string, onSwitched?: () => void) => Promise<void>;
  clearBranchData: (repoPath?: string | null) => void;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};
