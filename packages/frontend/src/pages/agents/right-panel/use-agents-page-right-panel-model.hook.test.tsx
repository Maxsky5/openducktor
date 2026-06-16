import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import {
  createHookHarness,
  createSelectedSessionTranscriptStateFixture,
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
  selectedView: {
    role: "build",
    taskId: "task-1",
    selectedTask: createTaskCardFixture({ id: "task-1" }),
    transcriptState: createSelectedSessionTranscriptStateFixture(),
  },
  session: {
    role: "build",
    activityState: "running",
    workingDirectory: "/repo",
    hasActiveSession: true,
  },
  panelKind: "documents",
  isPanelOpen: false,
  documentsModel: { activeDocument: null },
  repoSettings: { defaultTargetBranch: null } as never,
  worktreeRecoveryKey: "recovery-key-a",
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
        worktreeRecoveryKey: "recovery-key-b",
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
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        session: {
          role: "build",
          activityState: "waiting_input",
          workingDirectory: "/repo",
          hasActiveSession: true,
        },
        panelKind: "build_tools",
        isPanelOpen: true,
        worktreeRecoveryKey: "recovery-key",
      }),
    );

    await harness.mount();

    const gitActionCalls = gitActionsMock.mock.calls as unknown as Array<[GitActionsArgs]>;
    const latestGitActionArgs = gitActionCalls.at(-1)?.[0];
    expect(latestGitActionArgs?.isBuilderSessionWorking).toBe(false);

    await harness.unmount();
  });
});
