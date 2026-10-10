import { describe, expect, mock, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import { createSessionPanelFixture } from "@/test-utils/session-panel-fixtures";
import { createBuildToolsFixture } from "./agents-page-build-tools.test-support";
import { useAgentStudioRightPanelBridge } from "./use-agent-studio-right-panel-bridge";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRightPanelBridge>[0];

const createPanelState = (panel: Partial<HookArgs["panel"]> = {}): HookArgs["panel"] =>
  createSessionPanelFixture({
    tabs: [
      { id: "document", kind: "document" },
      { id: "diffs", kind: "diffs" },
      { id: "files", kind: "files" },
    ],
    selectedTabId: "diffs",
    ...panel,
  });

const createSelectionView = (
  overrides: Partial<HookArgs["selection"]["view"]> = {},
): HookArgs["selection"]["view"] => {
  const loadedSession = createAgentSessionFixture({
    externalSessionId: "session-1",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

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
      transcriptState: createSelectedSessionTranscriptStateFixture(),
      sessionAuxiliaryError: null,
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
  buildTools: createBuildToolsFixture(),
  selection: {
    view: createSelectionView(),
  },
  panel: createPanelState(),
  pullRequestReviewUnavailableReason: null,
  documentsModel: null,
  selectedFile: null,
  onSelectFile: mock(() => {}),
  setTaskTargetBranch: mock(async () => undefined),
  detectingPullRequestTaskId: null,
  onDetectPullRequest: mock((_taskId: string) => {}),
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
      expect(state.rightPanelBridge?.buildWorktreeRefresh.isPanelOpen).toBe(true);
      expect(state.rightPanelBridge?.rightPanel.activeWorkspace).toBe(args.activeWorkspace);
      expect(state.rightPanelBridge?.rightPanel.selectedView.taskId).toBe("task-1");
      expect(state.rightPanelBridge?.rightPanel.selectedView.role).toBe("build");
      expect(state.rightPanelBridge?.rightPanel.documentsModel).toBe(args.documentsModel);
      expect(state.rightPanelBridge?.rightPanel.buildTools).toBe(args.buildTools);
      expect(state.rightPanelBridge?.buildWorktreeRefresh.selectedView.loadedSession).toBe(
        args.selection.view.selectedSession.loadedSession,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("omits bridge props without a selected task", async () => {
    const harness = createHookHarness(
      createArgs({ selection: { view: createSelectionView({ taskId: "", selectedTask: null }) } }),
    );

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.rightPanelBridge).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the bridge for an empty right panel, which shows the New tab launcher", async () => {
    const harness = createHookHarness(
      createArgs({ panel: createPanelState({ tabs: [], selectedTabId: null }) }),
    );

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.rightPanelBridge?.buildWorktreeRefresh.isPanelOpen).toBe(true);
      expect(state.rightPanelBridge?.rightPanel.panel.tabs).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps refresh bridge props when the selected panel is closed", async () => {
    const harness = createHookHarness(
      createArgs({
        panel: createPanelState({ isVisible: false }),
      }),
    );

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.rightPanelBridge?.buildWorktreeRefresh.isPanelOpen).toBe(false);
      expect(state.selectedFileRefresh).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps selected file refresh active when the panel is closed", async () => {
    const selectedFile = {
      rootPath: "/repo/worktrees/task-1",
      relativePath: "src/index.ts",
    };
    const harness = createHookHarness(
      createArgs({
        selectedFile,
        panel: createPanelState({
          tabs: [{ id: "files", kind: "files" }],
          selectedTabId: "files",
          isVisible: false,
        }),
      }),
    );

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.rightPanelBridge?.buildWorktreeRefresh.isPanelOpen).toBe(false);
      expect(state.selectedFileRefresh).toEqual({
        selectedFile,
        selectedView: {
          role: "build",
          loadedSession: expect.objectContaining({ externalSessionId: "session-1" }),
        },
      });
    } finally {
      await harness.unmount();
    }
  });
});
