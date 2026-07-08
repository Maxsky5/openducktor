import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { type AgentSessionSummary, toAgentSessionSummary } from "@/state/agent-sessions-store";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";

enableReactActEnvironment();

type UseAgentsPageRightPanelModel =
  typeof import("./use-agents-page-right-panel-model")["useAgentsPageRightPanelModel"];
type BuildToolsSnapshotModule =
  typeof import("@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot");
type GitActionsModule = typeof import("../use-agent-studio-git-actions");
type GitActionsArgs = Parameters<GitActionsModule["useAgentStudioGitActions"]>[0];
type HookArgs = Parameters<UseAgentsPageRightPanelModel>[0];

let useAgentsPageRightPanelModel: UseAgentsPageRightPanelModel;
let realBuildToolsSnapshot: BuildToolsSnapshotModule | null = null;
let realGitActions: GitActionsModule | null = null;

const buildToolsSnapshotState: { current: Record<string, unknown> } = {
  current: {},
};

const gitActionsState: { current: Record<string, unknown> } = {
  current: {},
};

const buildToolsSnapshotMock = mock(() => buildToolsSnapshotState.current);
const gitActionsMock = mock(() => gitActionsState.current);

const createSnapshot = (gitConflictId: string | null) => ({
  context: {
    repoPath: "/repo",
    taskId: "task-1",
    selectedTaskId: "task-1",
    viewRole: "build",
    isSelectedBuilderWorking: true,
    sessionWorkingDirectory: "/repo",
    hasSelectedTask: true,
  },
  diffData: {
    fileStatuses: [],
    gitConflict: null,
    worktreePath: null,
    targetBranch: "origin/main",
    hashVersion: null,
    statusHash: null,
    diffHash: null,
    upstreamAheadBehind: null,
    isLoading: false,
    statusSnapshotKey: null,
    refresh: async () => {},
  },
  gitPanelContextMode: "documents",
  openInTarget: { path: null, disabledReason: null },
  resolvedGitPanelBranch: null,
  targetBranchState: {
    validationError: null,
    effectiveTargetBranch: "origin/main",
    selectionValue: "origin/main",
    displayTargetBranch: "origin/main",
  },
  devServerModel: {
    mode: "stopped",
    isExpanded: false,
    isLoading: false,
    disabledReason: null,
  },
  refreshWorktree: async () => {},
  gitConflictId,
});

const createGitActions = (gitConflictId: string | null) => ({
  gitConflict: gitConflictId
    ? ({
        operation: gitConflictId,
        currentBranch: null,
        targetBranch: "origin/main",
        conflictedFiles: [],
        output: "",
        workingDir: null,
      } as never)
    : null,
  askBuilderToResolveGitConflict: async () => {},
  isHandlingGitConflict: false,
  isCommitting: false,
  isPushing: false,
  isRebasing: false,
  isResetting: false,
  isResetDisabled: false,
  resetDisabledReason: null,
  gitConflictAction: "idle",
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
    error: null,
  },
  runtimeReadiness: {
    state: "ready",
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  transcriptState: { kind: "visible" },
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
    role: "build",
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
  buildToolsSnapshotState.current = createSnapshot("A");
  gitActionsState.current = createGitActions("A");

  realBuildToolsSnapshot = await import(
    "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot"
  );
  realGitActions = await import("../use-agent-studio-git-actions");

  mock.module(
    "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot",
    () => ({
      useAgentStudioBuildToolsWorktreeSnapshot: buildToolsSnapshotMock,
    }),
  );
  mock.module("../use-agent-studio-git-actions", () => ({
    useAgentStudioGitActions: gitActionsMock,
  }));

  ({ useAgentsPageRightPanelModel } = await import("./use-agents-page-right-panel-model"));
});

afterEach(async () => {
  const buildToolsSnapshot = realBuildToolsSnapshot;
  const gitActions = realGitActions;

  if (!buildToolsSnapshot || !gitActions) {
    return;
  }

  await restoreMockedModules([
    [
      "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot",
      () => Promise.resolve(buildToolsSnapshot),
    ],
    ["../use-agent-studio-git-actions", () => Promise.resolve(gitActions)],
  ]);
});

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: { repoPath: "/repo" } as never,
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
  repoSettings: { defaultTargetBranch: null } as never,
  detectingPullRequestTaskId: null,
  onDetectPullRequest: () => {},
  onResolveGitConflict: undefined as HookArgs["onResolveGitConflict"],
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
          events.push(context ? (context.conflict.operation as string) : null);
        },
      }),
    );

    await harness.mount();

    expect(events).toEqual(["A"]);

    buildToolsSnapshotState.current = createSnapshot("B");
    gitActionsState.current = createGitActions("B");

    await harness.update(
      createHookArgs({
        onGitConflictQuickActionContextChange: (context) => {
          events.push(context ? (context.conflict.operation as string) : null);
        },
      }),
    );

    expect(events).toEqual(["A", "B"]);

    await harness.unmount();

    expect(events).toEqual(["A", "B", null]);
  });

  test("does not lock git actions for a builder session waiting for input", async () => {
    const waitingInputSnapshot = createSnapshot("A");
    buildToolsSnapshotState.current = {
      ...waitingInputSnapshot,
      context: {
        ...waitingInputSnapshot.context,
        isSelectedBuilderWorking: false,
      },
    };
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        selectedView: createSelectedView({
          loadedSession: createAgentSessionFixture({
            role: "build",
            status: "running",
            workingDirectory: "/repo",
            pendingQuestions: [{ requestId: "question-1", questions: [] }],
          }),
        }),
        activeTabId: "git",
        isPanelOpen: true,
      }),
    );

    await harness.mount();

    const gitActionCalls = gitActionsMock.mock.calls as unknown as Array<[GitActionsArgs]>;
    const latestGitActionArgs = gitActionCalls.at(-1)?.[0];
    expect(latestGitActionArgs?.isBuilderSessionWorking).toBe(false);

    await harness.unmount();
  });

  test("locks git actions from selected-session summary while the full session is loading", async () => {
    const selectedSessionSummary = toAgentSessionSummary(
      createAgentSessionFixture({
        role: "build",
        status: "running",
        workingDirectory: "/repo/.worktrees/task-1",
      }),
    );
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        selectedView: createSelectedView({
          loadedSession: null,
          selectedSessionSummary,
        }),
        activeTabId: "git",
        isPanelOpen: true,
      }),
    );

    await harness.mount();

    const gitActionCalls = gitActionsMock.mock.calls as unknown as Array<[GitActionsArgs]>;
    const latestGitActionArgs = gitActionCalls.at(-1)?.[0];
    expect(latestGitActionArgs?.isBuilderSessionWorking).toBe(true);

    await harness.unmount();
  });
});
