import { describe, expect, mock, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskCardFixture, enableReactActEnvironment } from "../agent-studio-test-utils";
import {
  type AgentStudioTaskDetailsLauncherModel,
  useAgentStudioTaskDetailsLauncher,
} from "./use-agent-studio-task-details-launcher";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskDetailsLauncher>[0];

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });

const activeWorkspace: HookArgs["activeWorkspace"] = {
  workspaceId: "workspace-repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
};

const createArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace,
  tasks: [task],
  selectedTaskId: "task-1",
  detectingPullRequestTaskId: null,
  unlinkingPullRequestTaskId: null,
  onDetectPullRequest: mock((_taskId: string) => {}),
  onUnlinkPullRequest: mock((_taskId: string) => {}),
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioTaskDetailsLauncher, initialProps);

const attachControllerHandle = (model: AgentStudioTaskDetailsLauncherModel) => {
  const handle = {
    openTask: mock((_taskId: string) => {}),
    close: mock(() => {}),
  };
  model.taskDetailsSheetRef.current = handle;
  return handle;
};

describe("useAgentStudioTaskDetailsLauncher", () => {
  test("builds task-details controller props for the selected workspace", async () => {
    const onDetectPullRequest = mock((_taskId: string) => {});
    const onUnlinkPullRequest = mock((_taskId: string) => {});
    const harness = createHookHarness(
      createArgs({
        detectingPullRequestTaskId: "task-1",
        unlinkingPullRequestTaskId: "task-2",
        onDetectPullRequest,
        onUnlinkPullRequest,
      }),
    );

    try {
      await harness.mount();

      const props = harness.getLatest().taskDetailsSheetProps;
      expect(props.activeWorkspace).toBe(activeWorkspace);
      expect(props.allTasks).toEqual([task]);
      expect(props.workflowActionsEnabled).toBe(false);
      expect(props.onOpenSession).toBeUndefined();
      expect(props.taskSessionsByTaskId.size).toBe(0);
      expect(props.activeTaskSessionContextByTaskId.size).toBe(0);
      expect(props.detectingPullRequestTaskId).toBe("task-1");
      expect(props.unlinkingPullRequestTaskId).toBe("task-2");

      props.onDetectPullRequest?.("task-1");
      props.onUnlinkPullRequest?.("task-2");

      expect(onDetectPullRequest).toHaveBeenCalledWith("task-1");
      expect(onUnlinkPullRequest).toHaveBeenCalledWith("task-2");
    } finally {
      await harness.unmount();
    }
  });

  test("opens the selected task through the controller ref", async () => {
    const harness = createHookHarness(createArgs());

    try {
      await harness.mount();

      const handle = attachControllerHandle(harness.getLatest());
      await harness.run((model) => {
        model.openTaskDetails();
      });

      expect(handle.openTask).toHaveBeenCalledWith("task-1");
    } finally {
      await harness.unmount();
    }
  });

  test("does not open the sheet when no task is selected", async () => {
    const harness = createHookHarness(createArgs({ selectedTaskId: null }));

    try {
      await harness.mount();

      const handle = attachControllerHandle(harness.getLatest());
      await harness.run((model) => {
        model.openTaskDetails();
      });

      expect(handle.openTask).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
