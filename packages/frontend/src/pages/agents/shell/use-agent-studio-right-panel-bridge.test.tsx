import { describe, expect, mock, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import { useAgentStudioRightPanelBridge } from "./use-agent-studio-right-panel-bridge";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRightPanelBridge>[0];

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
const activeSession = createAgentSessionFixture({
  externalSessionId: "session-1",
  taskId: "task-1",
  role: "build",
  status: "running",
  workingDirectory: "/repo/worktrees/task-1",
});
const documentsModel: HookArgs["orchestration"]["agentStudioWorkspaceSidebarModel"] = {
  activeDocument: null,
};
const repoSettings: HookArgs["orchestration"]["repoSettings"] = null;

const activeWorkspace: HookArgs["activeWorkspace"] = {
  workspaceId: "workspace-repo",
  workspaceName: "Repo",
  repoPath: "/repo",
};

const createOrchestration = (
  rightPanel: HookArgs["orchestration"]["rightPanel"] = {
    panelKind: "build_tools",
    isPanelOpen: true,
  },
): HookArgs["orchestration"] =>
  ({
    agentStudioWorkspaceSidebarModel: documentsModel,
    repoSettings,
    rightPanel,
  }) as unknown as HookArgs["orchestration"];

const createArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace,
  branches: [],
  activeBranch: null,
  selection: {
    viewRole: "build",
    viewTaskId: "task-1",
    viewSelectedTask: task,
    viewActiveSession: activeSession,
    isViewSessionHistoryHydrating: false,
  },
  orchestration: createOrchestration(),
  worktreeRecoverySignal: 3,
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
    const harness = createHookHarness(createArgs());

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.isRightPanelVisible).toBe(true);
      expect(state.rightPanelBridge?.activeWorkspace).toBe(activeWorkspace);
      expect(state.rightPanelBridge?.viewTaskId).toBe("task-1");
      expect(state.rightPanelBridge?.viewRole).toBe("build");
      expect(state.rightPanelBridge?.documentsModel).toBe(documentsModel);
      expect(state.rightPanelBridge?.repoSettings).toBe(repoSettings);
      expect(state.rightPanelBridge?.activeSession).toBe(activeSession);
      expect(state.rightPanelBridge?.session).toEqual({
        role: "build",
        status: "running",
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
        orchestration: createOrchestration({
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
});
