import { describe, expect, mock, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
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
    tabs: [
      { id: "document", label: "Document" },
      { id: "git", label: "Git" },
      { id: "file_explorer", label: "File explorer" },
    ],
    activeTabId: "git",
    isPanelOpen: true,
    onActiveTabChange: mock(() => {}),
  },
): HookArgs["panel"] => panel;

const createSelectionView = (
  overrides: Partial<HookArgs["selection"]["view"]> = {},
): HookArgs["selection"]["view"] => {
  const loadedSession = createAgentSessionFixture({
    externalSessionId: "session-1",
    taskId: "task-1",
    role: "build",
    status: "running",
    workingDirectory: "/repo/worktrees/task-1",
  });
  return {
    role: "build",
    taskId: "task-1",
    selectedTask: createTaskCardFixture({ id: "task-1", title: "Task 1" }),
    sessionsForTask: [],
    selectedSession: {
      identity: toAgentSessionIdentity(loadedSession),
      activityState: "running",
      selectedModel: loadedSession.selectedModel,
      loadedSession,
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
      transcriptState: createSelectedSessionTranscriptStateFixture(),
    },
    launchActionId: "build_implementation_start",
    isTaskReady: true,
    ...overrides,
  };
};

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
  selectedFile: null,
  onSelectFile: mock(() => {}),
  repoSettings: null,
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
      expect(state.rightPanelBridge?.buildWorktreeRefresh.selectedView.loadedSession).toBe(
        args.selection.view.selectedSession.loadedSession,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("omits bridge props when no tab is selected", async () => {
    const harness = createHookHarness(
      createArgs({
        panel: createPanelState({
          tabs: [],
          activeTabId: null,
          isPanelOpen: true,
          onActiveTabChange: mock(() => {}),
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
          tabs: [
            { id: "document", label: "Document" },
            { id: "git", label: "Git" },
            { id: "file_explorer", label: "File explorer" },
          ],
          activeTabId: "git",
          isPanelOpen: false,
          onActiveTabChange: mock(() => {}),
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
