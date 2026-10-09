import type { GitConflict } from "@/features/agent-studio-git";
import type { AgentsPageBuildTools } from "./use-agents-page-build-tools";

type BuildToolsSnapshot = AgentsPageBuildTools["buildToolsSnapshot"];
type GitActionsState = AgentsPageBuildTools["gitActions"];
type ScopeState = BuildToolsSnapshot["diffData"]["scopeStatesByScope"]["target"];

export const createEmptyScopeStateFixture = (): ScopeState => ({
  branch: null,
  gitConflict: null,
  fileDiffs: [],
  fileStatuses: [],
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
});

export const createBuildToolsSnapshotFixture = ({
  refreshWorktree = async () => {},
}: { refreshWorktree?: BuildToolsSnapshot["refreshWorktree"] } = {}): BuildToolsSnapshot => ({
  isEnabled: true,
  context: {
    repoPath: "/repo",
    taskId: "task-1",
    selectedTaskId: "task-1",
    viewRole: "build",
    sessionWorkingDirectory: "/repo",
    hasSelectedTask: true,
  },
  diffData: {
    branch: null,
    fileStatuses: [],
    fileDiffs: [],
    uncommittedFileCount: 0,
    gitConflict: null,
    worktreePath: null,
    targetBranch: "origin/main",
    diffScope: "uncommitted",
    scopeStatesByScope: {
      target: createEmptyScopeStateFixture(),
      uncommitted: createEmptyScopeStateFixture(),
    },
    loadedScopesByScope: { target: false, uncommitted: true },
    upstreamStatus: "tracking",
    commitsAheadBehind: null,
    hashVersion: null,
    statusHash: null,
    diffHash: null,
    upstreamAheadBehind: null,
    isLoading: false,
    error: null,
    statusSnapshotKey: null,
    refresh: async () => {},
    setDiffScope: () => {},
  },
  gitPanelContextMode: "repository",
  openInTarget: { path: null, disabledReason: null },
  resolvedGitPanelBranch: null,
  repositoryBranchIdentityKey: null,
  targetBranchState: {
    validationError: null,
    effectiveTargetBranch: { remote: "origin", branch: "main" },
    selectionValue: "origin/main",
    displayTargetBranch: "origin/main",
  },
  worktree: {
    path: "/repo/.worktrees/task-1",
    status: "resolved",
    error: null,
    retry: async () => {},
    isResolving: false,
    shouldBlockDiffLoading: false,
    resolutionTaskId: null,
  },
  refreshWorktree,
});

export const createGitActionsFixture = (
  gitConflictOperation: GitConflict["operation"] | null,
): GitActionsState => ({
  gitConflict: gitConflictOperation
    ? {
        operation: gitConflictOperation,
        currentBranch: null,
        targetBranch: "origin/main",
        conflictedFiles: [],
        output: "",
        workingDir: null,
      }
    : null,
  askBuilderToResolveGitConflict: async () => {},
  isHandlingGitConflict: false,
  conflictRecipientLabel: "Builder",
  conflictAssistanceBlockedReason: null,
  conflictAssistanceIsStarting: false,
  isCommitting: false,
  isPushing: false,
  isRebasing: false,
  isResetting: false,
  isResetDisabled: false,
  resetDisabledReason: null,
  gitConflictAction: null,
  gitConflictAutoOpenNonce: 0,
  gitConflictCloseNonce: 0,
  showLockReasonBanner: false,
  isGitActionsLocked: false,
  gitActionsLockReason: null,
  pendingForcePush: null,
  pendingPullRebase: null,
  pendingReset: null,
  commitError: null,
  pushError: null,
  rebaseError: null,
  resetError: null,
  commitAll: async () => true,
  requestFileReset: () => {},
  requestHunkReset: () => {},
  confirmReset: async () => {},
  cancelReset: () => {},
  pushBranch: async () => {},
  confirmForcePush: async () => {},
  cancelForcePush: () => {},
  confirmPullRebase: async () => {},
  cancelPullRebase: () => {},
  rebaseOntoTarget: async () => {},
  abortGitConflict: async () => {},
  pullFromUpstream: async () => {},
});

export const createBuildToolsFixture = ({
  buildToolsSnapshot = createBuildToolsSnapshotFixture(),
  gitActions = createGitActionsFixture(null),
}: Partial<AgentsPageBuildTools> = {}): AgentsPageBuildTools => ({
  buildToolsSnapshot,
  gitActions,
});
