import { describe, expect, mock, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import { useAgentStudioRightPanelBridge } from "./use-agent-studio-right-panel-bridge";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRightPanelBridge>[0];

const createPanelState = (
  panel: HookArgs["panel"] = {
    panelKind: "build_tools",
    isPanelOpen: true,
  },
): HookArgs["panel"] => panel;

const createSelectionView = (
  overrides: Partial<HookArgs["selection"]["view"]> = {},
): HookArgs["selection"]["view"] => ({
  role: "build",
  taskId: "task-1",
  selectedTask: createTaskCardFixture({ id: "task-1", title: "Task 1" }),
  sessionsForTask: [],
  activeSessionSummary: null,
  activeSession: createAgentSessionFixture({
    externalSessionId: "session-1",
    taskId: "task-1",
    role: "build",
    status: "running",
    workingDirectory: "/repo/worktrees/task-1",
  }),
  sessionRuntimeData: {
    modelCatalog: null,
    todos: [],
    isLoadingModelCatalog: false,
  },
  sessionRuntimeDataError: null,
  runtimeReadiness: {
    readinessState: "ready",
    isReady: true,
    isRuntimeStarting: false,
    blockedReason: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  launchActionId: "build_implementation_start",
  isTaskReady: true,
  transcriptState: createSelectedSessionTranscriptStateFixture(),
  ...overrides,
});

const createArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: {
    workspaceId: "workspace-repo",
    workspaceName: "Repo",
    repoPath: "/repo",
  },
  branches: [],
  activeBranch: null,
  selection: {
    view: createSelectionView(),
  },
  panel: createPanelState(),
  documentsModel: {
    activeDocument: null,
  },
  repoSettings: null,
  worktreeRecoveryKey: "recovery-key",
  setTaskTargetBranch: mock(async () => undefined),
  detectingPullRequestTaskId: null,
  onDetectPullRequest: mock((_taskId: string) => {}),
  onResolveGitConflict: mock(async () => true),
  onGitConflictQuickActionContextChange: mock(() => {}),
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRightPanelBridge, initialProps);

describe("useAgentStudioRightPanelBridge", () => {
  test("builds the right-panel bridge model from orchestration selection", async () => {
    const args = createArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.isRightPanelVisible).toBe(true);
      expect(state.rightPanelBridge?.rightPanel.activeWorkspace).toBe(args.activeWorkspace);
      expect(state.rightPanelBridge?.rightPanel.selectedView.taskId).toBe("task-1");
      expect(state.rightPanelBridge?.rightPanel.selectedView.role).toBe("build");
      expect(state.rightPanelBridge?.rightPanel.documentsModel).toBe(args.documentsModel);
      expect(state.rightPanelBridge?.rightPanel.repoSettings).toBe(args.repoSettings);
      expect(state.rightPanelBridge?.buildWorktreeRefresh.selectedView.activeSession).toBe(
        args.selection.view.activeSession,
      );
      expect(state.rightPanelBridge?.buildWorktreeRefresh.selectedView.transcriptState).toBe(
        args.selection.view.transcriptState,
      );
      expect(state.rightPanelBridge?.rightPanel.selectedView.transcriptState).toBe(
        args.selection.view.transcriptState,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("omits bridge props when no panel kind is selected", async () => {
    const harness = createHookHarness(
      createArgs({
        panel: createPanelState({
          panelKind: null,
          isPanelOpen: true,
        }),
      }),
    );

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.isRightPanelVisible).toBe(false);
      expect(state.rightPanelBridge).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("omits bridge props when the selected panel is closed", async () => {
    const harness = createHookHarness(
      createArgs({
        panel: createPanelState({
          panelKind: "build_tools",
          isPanelOpen: false,
        }),
      }),
    );

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.isRightPanelVisible).toBe(false);
      expect(state.rightPanelBridge).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});
