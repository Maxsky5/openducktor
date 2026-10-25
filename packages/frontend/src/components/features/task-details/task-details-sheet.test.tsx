import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { ActiveWorkspaceContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { agentSessionQueryKeys } from "@openducktor/frontend-core/queries/agent-sessions";
import type {
  TaskStopImpactState,
  useTaskStopImpact,
} from "@openducktor/frontend-core/queries/use-task-stop-impact";
import { finishSheetExit, withSheetAnimations } from "@/test-utils/mock-sheet-animations";
import { createHookHarness as createSharedHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { createGitProviderContextFixture } from "@/test-utils/shared-test-fixtures";
import type { WorkspaceStateContextValue } from "@/types/state-slices";

enableReactActEnvironment();

const createWorkspaceStateValue = (): WorkspaceStateContextValue => ({
  isSwitchingWorkspace: false,
  closedWorkspaces: [],
  incompleteRemovals: [],
  closeWorkspace: async () => {},
  removeWorkspace: async () => {},
  reopenWorkspace: async () => {},
  resolveWorkspacePath: async () => ({ kind: "new" }),
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [],
  activeWorkspace: {
    workspaceId: "workspace-a",
    workspaceName: "Workspace A",
    abbreviation: null,
    tileColor: null,
    repoPath: "/repo-a",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/tmp/default-worktrees",
    effectiveWorktreeBasePath: "/tmp/default-worktrees",
  },
  branches: [],
  activeBranch: null,
  commitWorkspaceProviderSetup: async () => {
    throw new Error("Not used");
  },
  addWorkspace: async () => {
    throw new Error("Not used");
  },
  saveWorkspaceModelDefaults: async () => {
    throw new Error("Not used");
  },
  selectWorkspace: async () => {},
  reorderWorkspaces: async () => {},
  refreshBranches: async () => {},
  switchBranch: async () => {},
  loadRepoSettings: async () => {
    throw new Error("loadRepoSettings not configured");
  },
  saveRepoSettings: async () => {},
  loadSettingsSnapshot: async () => {
    throw new Error("loadSettingsSnapshot not configured");
  },
  detectGithubRepository: async () => null,
  saveGlobalGitConfig: async () => {},
  previewSettingsSnapshotRuntime: async () => ({ impact: null }),
  saveSettingsSnapshot: async () => ({
    type: "saved" as const,
    workspaces: [],
    runtimeApplications: [],
    refreshError: null,
  }),
  saveAgentModelFavorites: async () => {
    throw new Error("saveAgentModelFavorites is not used in this test");
  },
});

const createActiveWorkspaceValue = () => ({
  activeWorkspace: createWorkspaceStateValue().activeWorkspace,
  setActiveWorkspace: () => {},
});

const IsolatedProviders = ({ children }: PropsWithChildren) => (
  <QueryProvider>
    <WorkspaceStateContext.Provider value={createWorkspaceStateValue()}>
      <ActiveWorkspaceContext value={createActiveWorkspaceValue()}>
        {children}
      </ActiveWorkspaceContext>
    </WorkspaceStateContext.Provider>
  </QueryProvider>
);

const createTaskCleanupImpactHookMock = () =>
  mock((_taskIds: string[], _enabled: boolean) => ({
    hasCanonicalWorktree: false,
    hasManagedSessionCleanup: false,
    managedWorktreeCount: 0,
    legacyWorktreeCount: 0,
    impactError: null,
    isLoadingImpact: false,
    terminalCount: 0,
  }));

const createTaskStopImpactHookMock = () =>
  mock((_args: { taskIds: string[]; operation: string; enabled: boolean }) => ({
    stoppableSessionCount: null,
    removedWorktreeCount: null,
    isLoading: false,
    error: null,
  }));

const createTaskWorkflowActionsValue = (): TaskWorkflowActions => ({
  onCreateTask: mock(() => {}),
  onPlan: mock(() => {}),
  onQaStart: mock(() => {}),
  onQaOpen: mock(() => {}),
  onBuild: mock(() => {}),
  onOpenSession: mock(() => {}),
  onDelegate: mock(() => {}),
  onEdit: mock(() => {}),
  onOpenTaskDetails: mock(() => {}),
  onHumanApprove: mock(() => {}),
  onHumanRequestChanges: mock(() => {}),
  onResetImplementation: mock(() => {}),
  onResetTask: mock(async () => {}),
  onCloseTask: mock(async () => {}),
  onDelete: mock(async () => {}),
  onConfirmTaskAction: mock(() => {}),
  onDetectPullRequest: mock(() => {}),
  onUnlinkPullRequest: mock(() => {}),
  detectingPullRequestTaskIds: new Set<string>(),
  unlinkingPullRequestTaskIds: new Set<string>(),
  gitProviderContext: undefined,
  gitProviderReadError: null,
  registerTaskDetailsClose: mock(() => () => {}),
  taskSessionsByTaskId: new Map(),
  activeTaskSessionContextByTaskId: new Map(),
});

describe("TaskDetailsSheet", () => {
  test.each(["detect", "unlink"] as const)(
    "shows each task's %s progress without locking idle tasks",
    async (kind) => {
      const { TaskDetailsSheet } = await import("./task-details-sheet");
      const { TaskWorkflowActionsContext } =
        await import("@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context");
      const actions = createTaskWorkflowActionsValue();
      actions.gitProviderContext = createGitProviderContextFixture();
      const busyTaskIds = new Set(["TASK-1", "TASK-2"]);
      if (kind === "detect") actions.detectingPullRequestTaskIds = busyTaskIds;
      else actions.unlinkingPullRequestTaskIds = busyTaskIds;
      const task = createTaskCardFixture({
        id: "TASK-1",
        status: "human_review",
        pullRequest:
          kind === "unlink"
            ? {
                providerId: "github",
                number: 42,
                url: "https://github.com/openai/openducktor/pull/42",
                state: "open",
                createdAt: "2026-10-18T08:00:00Z",
                updatedAt: "2026-10-18T08:00:00Z",
              }
            : undefined,
      });
      task.agentWorkflows.build.completed = true;
      const sheet = (taskId: string) => {
        const shownTask = { ...task, id: taskId };
        return (
          <IsolatedProviders>
            <TaskWorkflowActionsContext.Provider value={actions}>
              <TaskDetailsSheet task={shownTask} open onOpenChange={() => {}} />
            </TaskWorkflowActionsContext.Provider>
          </IsolatedProviders>
        );
      };
      const view = render(sheet("TASK-1"));
      try {
        const buttonId =
          kind === "detect" ? "task-details-detect-pr-button" : "task-details-unlink-pr-button";
        expect(screen.getByTestId(buttonId).hasAttribute("disabled")).toBe(true);
        view.rerender(sheet("TASK-2"));
        expect(screen.getByTestId(buttonId).hasAttribute("disabled")).toBe(true);
        view.rerender(sheet("TASK-3"));
        expect(screen.getByTestId(buttonId).hasAttribute("disabled")).toBe(false);
      } finally {
        view.unmount();
      }
    },
  );

  test("passes activeWorkspace into task details view model", async () => {
    const { useTaskDetailsSheetViewModel } =
      await import("@openducktor/frontend-core/tasks/details/use-task-details-sheet-view-model");

    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      artifactSummary: {
        spec: { present: false, updatedAt: undefined },
        plan: { present: false, updatedAt: undefined },
        qaReport: { present: false, updatedAt: undefined },
      },
    });

    const taskCleanupImpactHookMock = createTaskCleanupImpactHookMock();

    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      open: true,
      onOpenChange: () => {},
      onPlan: undefined,
      onQaStart: undefined,
      onQaOpen: undefined,
      onBuild: undefined,
      onOpenSession: undefined,
      onDelegate: undefined,
      onHumanApprove: undefined,
      onHumanRequestChanges: undefined,
      onResetImplementation: undefined,
      onResetTask: undefined,
      onCloseTask: undefined,
      onDelete: undefined,
      taskCleanupImpactHook: taskCleanupImpactHookMock,
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });

    try {
      await harness.mount();
      expect(taskCleanupImpactHookMock).toHaveBeenNthCalledWith(1, ["TASK-1"], false);
      expect(taskCleanupImpactHookMock).toHaveBeenNthCalledWith(2, ["TASK-1"], false);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps delete confirm readiness tied to the authoritative stop-impact read", async () => {
    const { useTaskDetailsSheetViewModel } =
      await import("@openducktor/frontend-core/tasks/details/use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const loadingStopImpact: TaskStopImpactState = {
      stoppableSessionCount: null,
      removedWorktreeCount: null,
      isLoading: true,
      error: null,
    };
    const taskStopImpactHookMock = mock(
      (_args: Parameters<typeof useTaskStopImpact>[0]) => loadingStopImpact,
    );
    const harnessOptions = {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      open: true,
      onOpenChange: () => {},
      onPlan: undefined,
      onQaStart: undefined,
      onQaOpen: undefined,
      onBuild: undefined,
      onOpenSession: undefined,
      onDelegate: undefined,
      onHumanApprove: undefined,
      onHumanRequestChanges: undefined,
      onResetImplementation: undefined,
      onResetTask: undefined,
      onCloseTask: undefined,
      onDelete: mock(async () => {}),
      taskCleanupImpactHook: createTaskCleanupImpactHookMock(),
      taskStopImpactHook: taskStopImpactHookMock,
    };
    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, harnessOptions);

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.deleteConfirm.openDialog());

      // The worktree count comes with the stop impact, so the cleanup line waits for it too.
      expect(harness.getLatest().deleteConfirm.dialog.impact.isLoading).toBe(true);
      expect(harness.getLatest().deleteConfirm.dialog.impact.isLoadingStopImpact).toBe(true);

      taskStopImpactHookMock.mockImplementation(
        (_args: { taskIds: string[]; operation: string; enabled: boolean }) => ({
          stoppableSessionCount: 0,
          removedWorktreeCount: null,
          isLoading: false,
          error: null,
        }),
      );
      await harness.update({ ...harnessOptions });
      expect(harness.getLatest().deleteConfirm.dialog.impact.isLoading).toBe(false);
      expect(harness.getLatest().deleteConfirm.dialog.impact.isLoadingStopImpact).toBe(false);
      expect(harness.getLatest().deleteConfirm.dialog.impact.activeSessionCount).toBe(0);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces stop-impact preview failures to the delete dialog model", async () => {
    const { useTaskDetailsSheetViewModel } =
      await import("@openducktor/frontend-core/tasks/details/use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      open: true,
      onOpenChange: () => {},
      onPlan: undefined,
      onQaStart: undefined,
      onQaOpen: undefined,
      onBuild: undefined,
      onOpenSession: undefined,
      onDelegate: undefined,
      onHumanApprove: undefined,
      onHumanRequestChanges: undefined,
      onResetImplementation: undefined,
      onResetTask: undefined,
      onCloseTask: undefined,
      onDelete: mock(async () => {}),
      taskCleanupImpactHook: createTaskCleanupImpactHookMock(),
      taskStopImpactHook: () => ({
        stoppableSessionCount: null,
        removedWorktreeCount: null,
        isLoading: false,
        error: "host unavailable",
      }),
    });

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.deleteConfirm.openDialog());

      expect(harness.getLatest().deleteConfirm.dialog.impact.activeSessionCountError).toBe(
        "host unavailable",
      );
      expect(harness.getLatest().deleteConfirm.dialog.impact.isLoading).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("loads cleanup impact only for an available action's open confirmation", async () => {
    const { useTaskDetailsSheetViewModel } =
      await import("@openducktor/frontend-core/tasks/details/use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const taskCleanupImpactHookMock = createTaskCleanupImpactHookMock();
    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      open: true,
      onOpenChange: () => {},
      onPlan: undefined,
      onQaStart: undefined,
      onQaOpen: undefined,
      onBuild: undefined,
      onOpenSession: undefined,
      onDelegate: undefined,
      onHumanApprove: undefined,
      onHumanRequestChanges: undefined,
      onResetImplementation: undefined,
      onResetTask: mock(async () => {}),
      onCloseTask: mock(async () => {}),
      onDelete: mock(async () => {}),
      taskCleanupImpactHook: taskCleanupImpactHookMock,
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });
    // One cleanup read for each confirmation: Delete, Reset Task, and Close Task.
    const latestImpactCalls = () => taskCleanupImpactHookMock.mock.calls.slice(-3);

    try {
      await harness.mount();
      expect(latestImpactCalls()).toEqual([
        [["TASK-1"], false],
        [["TASK-1"], false],
        [["TASK-1"], false],
      ]);

      await harness.run((viewModel) => viewModel.deleteConfirm.openDialog());
      expect(latestImpactCalls()).toEqual([
        [["TASK-1"], true],
        [["TASK-1"], false],
        [["TASK-1"], false],
      ]);

      await harness.run((viewModel) => viewModel.deleteConfirm.dialog.onCancel());
      await harness.run((viewModel) => viewModel.resetConfirm.openDialog());
      expect(latestImpactCalls()).toEqual([
        [["TASK-1"], false],
        [["TASK-1"], true],
        [["TASK-1"], false],
      ]);

      await harness.run((viewModel) => viewModel.resetConfirm.dialog.onCancel());
      await harness.run((viewModel) => viewModel.closeConfirm.openDialog());
      expect(latestImpactCalls()).toEqual([
        [["TASK-1"], false],
        [["TASK-1"], false],
        [["TASK-1"], true],
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test.each([
    ["open_builder", [false]],
    ["human_approve", []],
  ] as const)("closes the sheet after %s only when it opens a session", async (action, closes) => {
    const { useTaskDetailsSheetViewModel } =
      await import("@openducktor/frontend-core/tasks/details/use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const onOpenChange = mock((_open: boolean) => {});
    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      task,
      open: true,
      onOpenChange,
      onOpenSession: mock(() => {}),
      onHumanApprove: mock(() => {}),
      taskCleanupImpactHook: createTaskCleanupImpactHookMock(),
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.runWorkflowAction(action));

      expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([...closes]);
    } finally {
      await harness.unmount();
    }
  });

  test("routes close_task to the confirmation dialog before invoking close", async () => {
    const { useTaskDetailsSheetViewModel } =
      await import("@openducktor/frontend-core/tasks/details/use-task-details-sheet-view-model");
    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      availableActions: ["close_task"],
    });
    const onCloseTask = mock(async () => {});
    const onOpenChange = mock(() => {});
    const taskCleanupImpactHookMock = createTaskCleanupImpactHookMock();

    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      open: true,
      onOpenChange,
      onPlan: undefined,
      onQaStart: undefined,
      onQaOpen: undefined,
      onBuild: undefined,
      onOpenSession: undefined,
      onDelegate: undefined,
      onHumanApprove: undefined,
      onHumanRequestChanges: undefined,
      onResetImplementation: undefined,
      onResetTask: undefined,
      onCloseTask,
      onDelete: undefined,
      taskCleanupImpactHook: taskCleanupImpactHookMock,
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.runWorkflowAction("close_task"));

      expect(harness.getLatest().closeConfirm.dialog.open).toBe(true);
      expect(onCloseTask).not.toHaveBeenCalled();

      await harness.run((viewModel) => viewModel.closeConfirm.dialog.onConfirm());

      expect(onCloseTask).toHaveBeenCalledWith("TASK-1");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps close dialog open and surfaces close failures", async () => {
    const { useTaskDetailsSheetViewModel } =
      await import("@openducktor/frontend-core/tasks/details/use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-2", title: "Task 2" });
    const onCloseTask = mock(async () => {
      throw new Error("close failed");
    });
    const taskCleanupImpactHookMock = createTaskCleanupImpactHookMock();

    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      open: true,
      onOpenChange: () => {},
      onPlan: undefined,
      onQaStart: undefined,
      onQaOpen: undefined,
      onBuild: undefined,
      onOpenSession: undefined,
      onDelegate: undefined,
      onHumanApprove: undefined,
      onHumanRequestChanges: undefined,
      onResetImplementation: undefined,
      onResetTask: undefined,
      onCloseTask,
      onDelete: undefined,
      taskCleanupImpactHook: taskCleanupImpactHookMock,
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.closeConfirm.openDialog());
      await harness.run((viewModel) => viewModel.closeConfirm.dialog.onConfirm());

      expect(harness.getLatest().closeConfirm.dialog.open).toBe(true);
      expect(harness.getLatest().closeConfirm.dialog.operation.error).toBe("close failed");
    } finally {
      await harness.unmount();
    }
  });

  test("renders without the top-right close control", async () => {
    const { TaskDetailsSheet } = await import("./task-details-sheet");

    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      artifactSummary: {
        spec: { present: false, updatedAt: undefined },
        plan: { present: false, updatedAt: undefined },
        qaReport: { present: false, updatedAt: undefined },
      },
    });

    const html = renderToStaticMarkup(
      createElement(
        IsolatedProviders,
        null,
        createElement(TaskDetailsSheet, {
          activeWorkspace: {
            workspaceId: "workspace-a",
            workspaceName: "Workspace A",
            repoPath: "/repo-a",
          },
          task,
          open: true,
          onOpenChange: () => {},
        }),
      ),
    );

    expect(html).not.toContain('<span class="sr-only">Close</span>');
  });

  test("keeps the closed task in place until the sheet exit ends", async () => {
    const { TaskDetailsSheet } = await import("./task-details-sheet");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    // The controller clears the task and closes the sheet in the same render.
    const renderSheet = (open: boolean) =>
      createElement(
        IsolatedProviders,
        null,
        createElement(TaskDetailsSheet, {
          task: open ? task : null,
          open,
          onOpenChange: () => {},
        }),
      );

    await withSheetAnimations(() => {
      const view = render(renderSheet(true));
      try {
        const sheet = screen.getByRole("dialog", { name: "Task 1" });
        const overlay = screen.getByLabelText("Close sheet overlay");

        view.rerender(renderSheet(false));
        expect(sheet.isConnected).toBe(true);
        expect(sheet.getAttribute("data-state")).toBe("closed");
        expect(overlay.isConnected).toBe(true);
        expect(overlay.getAttribute("data-state")).toBe("closed");
        expect(sheet.textContent).toContain("Task 1");

        finishSheetExit();
        expect(sheet.isConnected).toBe(false);
        expect(overlay.isConnected).toBe(false);
      } finally {
        view.unmount();
      }
    });
  });

  test("removes the closed task at once when the sheet has no exit animation", async () => {
    const { TaskDetailsSheet } = await import("./task-details-sheet");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const renderSheet = (open: boolean) =>
      createElement(
        IsolatedProviders,
        null,
        createElement(TaskDetailsSheet, {
          task: open ? task : null,
          open,
          onOpenChange: () => {},
        }),
      );

    const view = render(renderSheet(true));
    try {
      view.rerender(renderSheet(false));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByLabelText("Close sheet overlay")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("keeps the sheet open when focus moves into its confirm dialog", async () => {
    const { TaskDetailsSheet } = await import("./task-details-sheet");
    const { TaskWorkflowActionsContext } =
      await import("@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context");
    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      availableActions: ["close_task"],
    });
    const onOpenChange = mock((_open: boolean) => {});

    const { unmount } = render(
      createElement(
        IsolatedProviders,
        null,
        createElement(
          TaskWorkflowActionsContext.Provider,
          { value: createTaskWorkflowActionsValue() },
          createElement(TaskDetailsSheet, { task, open: true, onOpenChange }),
        ),
      ),
    );

    try {
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      const closeTask = screen.getByRole("button", { name: "Close Task" });
      closeTask.focus();
      fireEvent.click(closeTask);
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

      expect(screen.getByRole("dialog", { name: "Close Task" })).toBeTruthy();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    } finally {
      unmount();
    }
  });

  test("closes the sheet when focus moves into an unrelated dialog", async () => {
    const { TaskDetailsSheet } = await import("./task-details-sheet");
    const { Dialog, DialogContent, DialogTitle } = await import("@/components/ui/dialog");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const onOpenChange = mock((_open: boolean) => {});
    const renderSheet = (editorOpen: boolean) =>
      createElement(
        IsolatedProviders,
        null,
        createElement(TaskDetailsSheet, { task, open: true, onOpenChange }),
        createElement(
          Dialog,
          { open: editorOpen },
          createElement(DialogContent, null, createElement(DialogTitle, null, "Edit task")),
        ),
      );

    const view = render(renderSheet(false));
    try {
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      view.rerender(renderSheet(true));
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      view.unmount();
    }
  });

  test("focuses the sheet instead of the copy button when it opens", async () => {
    const { TaskDetailsSheet } = await import("./task-details-sheet");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });

    const { unmount } = render(
      createElement(
        IsolatedProviders,
        null,
        createElement(TaskDetailsSheet, {
          task,
          open: true,
          onOpenChange: () => {},
        }),
      ),
    );

    try {
      const sheet = screen.getByRole("dialog");
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(document.activeElement).toBe(sheet);
      expect(screen.queryByRole("tooltip", { name: "Copy" })).toBeNull();
    } finally {
      unmount();
    }
  });

  test("dispatches a workflow action through the task workflow context", async () => {
    const { TaskDetailsSheet } = await import("./task-details-sheet");
    const { TaskWorkflowActionsContext } =
      await import("@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context");

    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      status: "ready_for_dev",
      availableActions: ["build_start"],
      artifactSummary: {
        spec: { present: false, updatedAt: undefined },
        plan: { present: false, updatedAt: undefined },
        qaReport: { present: false, updatedAt: undefined },
      },
    });
    const actions = createTaskWorkflowActionsValue();
    const connection = createTestClientConnection();
    const queryClient = connection.queryClient;
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo-a", "TASK-1"), []);

    const { unmount } = render(
      createElement(
        ClientConnectionProvider,
        { connection },
        createElement(
          WorkspaceStateContext.Provider,
          { value: createWorkspaceStateValue() },
          createElement(
            ActiveWorkspaceContext,
            { value: createActiveWorkspaceValue() },
            createElement(
              TaskWorkflowActionsContext.Provider,
              { value: actions },
              createElement(TaskDetailsSheet, {
                activeWorkspace: {
                  workspaceId: "workspace-a",
                  workspaceName: "Workspace A",
                  repoPath: "/repo-a",
                },
                task,
                open: true,
                onOpenChange: () => {},
              }),
            ),
          ),
        ),
      ),
    );

    fireEvent.click(screen.getByText("Start Builder"));

    expect(actions.onDelegate).toHaveBeenCalledWith("TASK-1");

    unmount();
  });
});
