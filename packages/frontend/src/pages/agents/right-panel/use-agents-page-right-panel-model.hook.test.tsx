import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { GitConflict, PullRequest } from "@openducktor/contracts";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createQueryClient } from "@/lib/query-client";
import { type AgentSessionSummary, toAgentSessionSummary } from "@/state/agent-sessions-store";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";

enableReactActEnvironment();

type UseAgentsPageRightPanelModel =
  (typeof import("./use-agents-page-right-panel-model"))["useAgentsPageRightPanelModel"];
type BuildToolsSnapshotModule =
  typeof import("@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot");
type GitActionsModule = typeof import("../use-agent-studio-git-actions");
type PullRequestReviewQueriesModule = typeof import("@/state/queries/pull-request-review");
type HookArgs = Parameters<UseAgentsPageRightPanelModel>[0];

let useAgentsPageRightPanelModel: UseAgentsPageRightPanelModel;
const realBuildToolsSnapshot: BuildToolsSnapshotModule =
  await import("@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot");
const realGitActions: GitActionsModule = await import("../use-agent-studio-git-actions");
const realPullRequestReviewQueries: PullRequestReviewQueriesModule =
  await import("@/state/queries/pull-request-review");
let testSpies: Array<{ mockRestore(): void }> = [];

type BuildToolsSnapshotHook = BuildToolsSnapshotModule["useAgentStudioBuildToolsWorktreeSnapshot"];
type GitActionsHook = GitActionsModule["useAgentStudioGitActions"];
type BuildToolsSnapshot = ReturnType<BuildToolsSnapshotHook>;
type GitActionsState = ReturnType<GitActionsHook>;

const buildToolsSnapshotMock = mock<BuildToolsSnapshotHook>(() => buildToolsSnapshotState.current);
const gitActionsMock = mock<GitActionsHook>(() => gitActionsState.current);
type PrefetchPullRequestReviewContext =
  PullRequestReviewQueriesModule["prefetchPullRequestReviewContextFromQuery"];
const prefetchPullRequestReviewContextMock = mock(
  async (
    _queryClient: Parameters<PrefetchPullRequestReviewContext>[0],
    _input: Parameters<PrefetchPullRequestReviewContext>[1],
  ) => {},
);
const refreshWorktreeMock = mock<BuildToolsSnapshot["refreshWorktree"]>(async () => {});

const linkedPullRequest = {
  providerId: "github",
  number: 42,
  url: "https://github.com/openai/openducktor/pull/42",
  state: "open",
  createdAt: "2026-07-08T10:00:00Z",
  updatedAt: "2026-07-08T10:05:00Z",
} satisfies PullRequest;

const createEmptyScopeState =
  (): BuildToolsSnapshot["diffData"]["scopeStatesByScope"]["target"] => ({
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

const createSnapshot = (): BuildToolsSnapshot => ({
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
      target: createEmptyScopeState(),
      uncommitted: createEmptyScopeState(),
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
  devServerModel: {
    mode: "stopped",
    isExpanded: false,
    isLoading: false,
    disabledReason: null,
    repoPath: "/repo",
    taskId: "task-1",
    worktreePath: "/repo/.worktrees/task-1",
    scripts: [],
    selectedScriptId: null,
    selectedScript: null,
    selectedScriptTerminalBuffer: null,
    error: null,
    isStartPending: false,
    isStopPending: false,
    isRestartPending: false,
    onSelectScript: () => {},
    onStart: () => {},
    onStop: () => {},
    onRestart: () => {},
  },
  refreshWorktree: refreshWorktreeMock,
});

const createGitActions = (gitConflictId: GitConflict["operation"] | null): GitActionsState => ({
  gitConflict: gitConflictId
    ? {
        operation: gitConflictId,
        currentBranch: null,
        targetBranch: "origin/main",
        conflictedFiles: [],
        output: "",
        workingDir: null,
      }
    : null,
  askBuilderToResolveGitConflict: async () => {},
  isHandlingGitConflict: false,
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

const buildToolsSnapshotState = { current: createSnapshot() };
const gitActionsState = { current: createGitActions(null) };

type SelectedViewOverrides = Partial<HookArgs["selectedView"]> & {
  loadedSession?: AgentSessionState | null;
  selectedSessionIdentity?: AgentSessionIdentity | null;
  selectedSessionActivityState?: HookArgs["selectedView"]["selectedSession"]["activityState"];
  selectedSessionSummary?: AgentSessionSummary | null;
};

const createSelectedSession = (
  overrides: Partial<HookArgs["selectedView"]["selectedSession"]> = {},
): HookArgs["selectedView"]["selectedSession"] => ({
  identity: null,
  activityState: null,
  selectedModel: null,
  loadedSession: null,
  runtimeData: {
    modelCatalog: null,
    todos: [],
    isLoadingModelCatalog: false,
    catalogError: null,
    todosError: null,
    runtimePolicyError: null,
    contextError: null,
  },
  runtimeReadiness: {
    state: "ready",
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  transcriptState: { kind: "visible" },
  sessionAuxiliaryError: null,
  ...overrides,
});

const createSelectedView = (overrides: SelectedViewOverrides = {}): HookArgs["selectedView"] => {
  const {
    loadedSession: loadedSessionOverride,
    selectedSessionIdentity: selectedSessionIdentityOverride,
    selectedSessionSummary: selectedSessionSummaryOverride,
    role = "build",
    ...viewOverrides
  } = overrides;
  const defaultSession = createAgentSessionFixture({
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    status: "running",
    workingDirectory: "/repo",
  });
  const loadedSession =
    "loadedSession" in overrides ? (loadedSessionOverride ?? null) : defaultSession;
  const selectedSessionSummary =
    "selectedSessionSummary" in overrides
      ? (selectedSessionSummaryOverride ?? null)
      : loadedSession
        ? toAgentSessionSummary(loadedSession)
        : null;
  const selectedSessionIdentity =
    "selectedSessionIdentity" in overrides
      ? (selectedSessionIdentityOverride ?? null)
      : (selectedSessionSummary ?? (loadedSession ? toAgentSessionIdentity(loadedSession) : null));
  const selectedSessionActivityState =
    "selectedSessionActivityState" in overrides
      ? (overrides.selectedSessionActivityState ?? null)
      : (selectedSessionSummary?.activityState ?? null);

  return {
    role,
    taskId: "task-1",
    selectedTask: createTaskCardFixture({ id: "task-1" }),
    selectedSession: createSelectedSession({
      identity: selectedSessionIdentity,
      activityState: selectedSessionActivityState,
      loadedSession,
    }),
    ...viewOverrides,
  };
};

beforeEach(async () => {
  prefetchPullRequestReviewContextMock.mockClear();
  refreshWorktreeMock.mockClear();
  buildToolsSnapshotState.current = createSnapshot();
  gitActionsState.current = createGitActions("rebase");

  testSpies = [
    spyOn(realBuildToolsSnapshot, "useAgentStudioBuildToolsWorktreeSnapshot").mockImplementation(
      buildToolsSnapshotMock,
    ),
    spyOn(realGitActions, "useAgentStudioGitActions").mockImplementation(gitActionsMock),
    spyOn(
      realPullRequestReviewQueries,
      "prefetchPullRequestReviewContextFromQuery",
    ).mockImplementation(prefetchPullRequestReviewContextMock),
  ];

  ({ useAgentsPageRightPanelModel } = await import("./use-agents-page-right-panel-model"));
});

afterEach(() => {
  for (const testSpy of testSpies) testSpy.mockRestore();
  testSpies = [];
});

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: {
    workspaceId: "workspace-repo",
    workspaceName: "Repo",
    repoPath: "/repo",
  },
  branches: [],
  activeBranch: null,
  selectedView: createSelectedView(),
  tabs: [
    { id: "document", label: "Document" },
    { id: "git", label: "Git" },
    { id: "file_explorer", label: "File explorer" },
  ],
  activeTabId: "document",
  onActiveTabChange: () => {},
  isPanelOpen: false,
  documentsModel: { activeDocument: null },
  selectedFile: null,
  onSelectFile: () => {},
  onClearSelectedFile: () => {},
  repoSettings: {
    defaultRuntimeKind: "opencode",
    worktreeBasePath: "",
    branchPrefix: "codex/",
    defaultTargetBranch: { remote: "origin", branch: "main" },
    preStartHooks: [],
    postCompleteHooks: [],
    devServers: [],
    worktreeCopyPaths: [],
    agentDefaults: { spec: null, planner: null, build: null, qa: null },
  },
  detectingPullRequestTaskId: null,
  onDetectPullRequest: () => {},
  onResolveGitConflict: undefined,
  onGitConflictQuickActionContextChange: () => {},
  ...overrides,
});

describe("useAgentsPageRightPanelModel", () => {
  test("publishes conflict context changes without intermediate null and clears on unmount", async () => {
    const events: Array<string | null> = [];

    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        onGitConflictQuickActionContextChange: (context) => {
          events.push(context ? context.conflict.operation : null);
        },
      }),
    );

    await harness.mount();

    expect(events).toEqual(["rebase"]);

    buildToolsSnapshotState.current = createSnapshot();
    gitActionsState.current = createGitActions("pull_rebase");

    await harness.update(
      createHookArgs({
        onGitConflictQuickActionContextChange: (context) => {
          events.push(context ? context.conflict.operation : null);
        },
      }),
    );

    expect(events).toEqual(["rebase", "pull_rebase"]);

    await harness.unmount();

    expect(events).toEqual(["rebase", "pull_rebase", null]);
  });

  test("prefetches CI review data in the background for linked pull requests", async () => {
    const queryClient = createQueryClient();
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        selectedView: createSelectedView({
          selectedTask: createTaskCardFixture({
            id: "task-1",
            pullRequest: linkedPullRequest,
          }),
        }),
        tabs: [
          { id: "git", label: "Git" },
          { id: "file_explorer", label: "File explorer" },
          { id: "ci_checks", label: "CI Checks" },
        ],
        activeTabId: "git",
        isPanelOpen: false,
      }),
      { queryClient },
    );

    await harness.mount();

    expect(prefetchPullRequestReviewContextMock).toHaveBeenCalledTimes(1);
    expect(prefetchPullRequestReviewContextMock.mock.calls[0]?.[0]).toBe(queryClient);
    expect(prefetchPullRequestReviewContextMock.mock.calls[0]?.[1]).toEqual({
      repoPath: "/repo",
      taskId: "task-1",
      pullRequest: { providerId: "github", number: 42 },
    });

    await harness.unmount();
  });

  test("refreshes Git and invalidates file explorer data after builder mutations", async () => {
    const queryClient = createQueryClient();
    const requestedRootPath = "/repo-link/.worktrees/task-1";
    const canonicalRootPath = "/repo/.worktrees/task-1";
    const snapshot = createSnapshot();
    buildToolsSnapshotState.current = {
      ...snapshot,
      gitPanelContextMode: "worktree",
      worktree: {
        ...snapshot.worktree,
        path: requestedRootPath,
      },
    };
    const selectedFile = { rootPath: canonicalRootPath, relativePath: "src/index.ts" };
    const treeKey = filesystemQueryKeys.tree(requestedRootPath, "origin/main");
    const textFileKey = filesystemQueryKeys.textFile(canonicalRootPath, selectedFile.relativePath);
    queryClient.setQueryData(treeKey, { entries: [] });
    queryClient.setQueryData(textFileKey, { kind: "text" });
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        activeTabId: "file_explorer",
        isPanelOpen: true,
        selectedFile,
      }),
      { queryClient },
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.refreshWorktree("soft");
    });

    expect(refreshWorktreeMock).toHaveBeenCalledWith("soft");
    expect(queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(textFileKey)?.isInvalidated).toBe(true);

    await harness.unmount();
    queryClient.clear();
  });

  test("does not prefetch CI review data without a linked pull request", async () => {
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        tabs: [
          { id: "git", label: "Git" },
          { id: "file_explorer", label: "File explorer" },
          { id: "ci_checks", label: "CI Checks" },
        ],
        activeTabId: "git",
      }),
    );

    await harness.mount();

    expect(prefetchPullRequestReviewContextMock).not.toHaveBeenCalled();

    await harness.unmount();
  });
});
