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

const createArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: {
    workspaceId: "workspace-repo",
    workspaceName: "Repo",
    repoPath: "/repo",
  },
  branches: [],
  activeBranch: null,
  selection: {
    viewRole: "build",
    viewTaskId: "task-1",
    viewSelectedTask: createTaskCardFixture({ id: "task-1", title: "Task 1" }),
    viewActiveSession: createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      role: "build",
      status: "running",
      workingDirectory: "/repo/worktrees/task-1",
    }),
    viewTranscriptState: createSelectedSessionTranscriptStateFixture(),
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
      expect(state.rightPanelBridge?.rightPanel.viewTaskId).toBe("task-1");
      expect(state.rightPanelBridge?.rightPanel.viewRole).toBe("build");
      expect(state.rightPanelBridge?.rightPanel.documentsModel).toBe(args.documentsModel);
      expect(state.rightPanelBridge?.rightPanel.repoSettings).toBe(args.repoSettings);
      expect(state.rightPanelBridge?.buildWorktreeRefresh.activeSession).toBe(
        args.selection.viewActiveSession,
      );
      expect(state.rightPanelBridge?.buildWorktreeRefresh.transcriptState).toBe(
        args.selection.viewTranscriptState,
      );
      expect(state.rightPanelBridge?.rightPanel.transcriptState).toBe(
        args.selection.viewTranscriptState,
      );
      expect(state.rightPanelBridge?.rightPanel.session).toEqual({
        role: "build",
        activityState: "running",
        workingDirectory: "/repo/worktrees/task-1",
        hasActiveSession: true,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("projects waiting-input activity into the right-panel session descriptor", async () => {
    const harness = createHookHarness(
      createArgs({
        selection: {
          ...createArgs().selection,
          viewActiveSession: createAgentSessionFixture({
            externalSessionId: "session-1",
            taskId: "task-1",
            role: "build",
            status: "running",
            workingDirectory: "/repo/worktrees/task-1",
            pendingQuestions: [{ requestId: "question-1", questions: [] }],
          }),
        },
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().rightPanelBridge?.rightPanel.session).toMatchObject({
        role: "build",
        activityState: "waiting_input",
        workingDirectory: "/repo/worktrees/task-1",
        hasActiveSession: true,
      });
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
