import { describe, expect, mock, test } from "bun:test";
import { createElement, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryProvider } from "@/lib/query-provider";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import type { TaskStopImpactState, useTaskStopImpact } from "@/state/queries/use-task-stop-impact";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { WorkspaceStateContextValue } from "@/types/state-slices";

enableReactActEnvironment();

const createWorkspaceStateValue = (): WorkspaceStateContextValue => ({
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [],
  activeWorkspace: {
    workspaceId: "workspace-a",
    workspaceName: "Workspace A",
    repoPath: "/repo-a",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/tmp/default-worktrees",
    effectiveWorktreeBasePath: "/tmp/default-worktrees",
  },
  branches: [],
  activeBranch: null,
  addWorkspace: async () => {},
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
  saveSettingsSnapshot: async () => {},
  saveAgentModelFavorites: async () => {
    throw new Error("saveAgentModelFavorites is not used in this test");
  },
});

const IsolatedProviders = ({ children }: PropsWithChildren) => (
  <QueryProvider useIsolatedClient>
    <WorkspaceStateContext.Provider value={createWorkspaceStateValue()}>
      {children}
    </WorkspaceStateContext.Provider>
  </QueryProvider>
);

const createTaskDocumentsHookMock = () =>
  mock((_taskId: string | null, _open: boolean, _cacheScope = "") => ({
    specDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
    planDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
    qaDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
    ensureDocumentLoaded: () => false,
    reloadDocument: () => false,
    applyDocumentUpdate: () => {},
  }));

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
    isLoading: false,
    error: null,
  }));

describe("TaskDetailsSheet", () => {
  test("passes activeWorkspace into task details view model", async () => {
    const { useTaskDetailsSheetViewModel } = await import("./use-task-details-sheet-view-model");

    const childTask = createTaskCardFixture({
      id: "TASK-2",
      title: "Task 2",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
      },
    });
    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      issueType: "epic",
      subtaskIds: ["TASK-2"],
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
      },
    });

    const taskDocumentsHookMock = createTaskDocumentsHookMock();
    const taskCleanupImpactHookMock = createTaskCleanupImpactHookMock();

    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      allTasks: [task, childTask],
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
      taskDocumentsHook: taskDocumentsHookMock,
      taskCleanupImpactHook: taskCleanupImpactHookMock,
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });

    try {
      await harness.mount();
      expect(taskDocumentsHookMock).toHaveBeenCalledWith("TASK-1", true, "/repo-a");
      expect(taskCleanupImpactHookMock).toHaveBeenNthCalledWith(1, ["TASK-1", "TASK-2"], false);
      expect(taskCleanupImpactHookMock).toHaveBeenNthCalledWith(2, ["TASK-1"], false);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps delete confirm readiness tied to the authoritative stop-impact read", async () => {
    const { useTaskDetailsSheetViewModel } = await import("./use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const loadingStopImpact: TaskStopImpactState = {
      stoppableSessionCount: null,
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
      allTasks: [task],
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
      taskDocumentsHook: createTaskDocumentsHookMock(),
      taskCleanupImpactHook: createTaskCleanupImpactHookMock(),
      taskStopImpactHook: taskStopImpactHookMock,
    };
    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, harnessOptions);

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.openDeleteDialog());

      expect(harness.getLatest().isLoadingDeleteImpact).toBe(false);
      expect(harness.getLatest().isLoadingDeleteStopImpact).toBe(true);

      taskStopImpactHookMock.mockImplementation(
        (_args: { taskIds: string[]; operation: string; enabled: boolean }) => ({
          stoppableSessionCount: 0,
          isLoading: false,
          error: null,
        }),
      );
      await harness.update({ ...harnessOptions });
      expect(harness.getLatest().isLoadingDeleteStopImpact).toBe(false);
      expect(harness.getLatest().deleteActiveSessionCount).toBe(0);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces stop-impact preview failures to the delete dialog model", async () => {
    const { useTaskDetailsSheetViewModel } = await import("./use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      allTasks: [task],
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
      taskDocumentsHook: createTaskDocumentsHookMock(),
      taskCleanupImpactHook: createTaskCleanupImpactHookMock(),
      taskStopImpactHook: () => ({
        stoppableSessionCount: null,
        isLoading: false,
        error: "host unavailable",
      }),
    });

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.openDeleteDialog());

      expect(harness.getLatest().deleteActiveSessionCountError).toBe("host unavailable");
      expect(harness.getLatest().isLoadingDeleteImpact).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("loads cleanup impact only for an available action's open confirmation", async () => {
    const { useTaskDetailsSheetViewModel } = await import("./use-task-details-sheet-view-model");
    const childTask = createTaskCardFixture({ id: "TASK-2", title: "Task 2" });
    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      issueType: "epic",
      subtaskIds: ["TASK-2"],
    });
    const taskCleanupImpactHookMock = createTaskCleanupImpactHookMock();
    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      allTasks: [task, childTask],
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
      taskDocumentsHook: createTaskDocumentsHookMock(),
      taskCleanupImpactHook: taskCleanupImpactHookMock,
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });
    const latestImpactCalls = () => taskCleanupImpactHookMock.mock.calls.slice(-2);

    try {
      await harness.mount();
      expect(latestImpactCalls()).toEqual([
        [["TASK-1", "TASK-2"], false],
        [["TASK-1"], false],
      ]);

      await harness.run((viewModel) => viewModel.openDeleteDialog());
      expect(latestImpactCalls()).toEqual([
        [["TASK-1", "TASK-2"], true],
        [["TASK-1"], false],
      ]);

      await harness.run((viewModel) => viewModel.closeDeleteDialog());
      await harness.run((viewModel) => viewModel.openResetDialog());
      expect(latestImpactCalls()).toEqual([
        [["TASK-1", "TASK-2"], false],
        [["TASK-1"], true],
      ]);

      await harness.run((viewModel) => viewModel.closeResetDialog());
      await harness.run((viewModel) => viewModel.openCloseDialog());
      expect(latestImpactCalls()).toEqual([
        [["TASK-1", "TASK-2"], false],
        [["TASK-1"], true],
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("stops task document reads while deletion is pending", async () => {
    const { useTaskDetailsSheetViewModel } = await import("./use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-1", title: "Task 1" });
    const taskDocumentsHookMock = createTaskDocumentsHookMock();
    let finishDelete: () => void = () => {};
    const deletePending = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const onDelete = mock(() => deletePending);
    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      allTasks: [task],
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
      onDelete,
      taskDocumentsHook: taskDocumentsHookMock,
      taskCleanupImpactHook: createTaskCleanupImpactHookMock(),
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.openDeleteDialog());
      const callsBeforeDelete = taskDocumentsHookMock.mock.calls.length;

      await harness.run((viewModel) => viewModel.confirmDelete());

      expect(onDelete).toHaveBeenCalledWith("TASK-1", { deleteSubtasks: true });
      expect(harness.getLatest().isDeletePending).toBe(true);
      expect(taskDocumentsHookMock.mock.calls.slice(callsBeforeDelete).at(-1)?.[1]).toBe(false);
    } finally {
      finishDelete();
      await harness.unmount();
    }
  });

  test("routes close_task to the confirmation dialog before invoking close", async () => {
    const { useTaskDetailsSheetViewModel } = await import("./use-task-details-sheet-view-model");
    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      availableActions: ["close_task"],
    });
    const onCloseTask = mock(async () => {});
    const onOpenChange = mock(() => {});
    const taskDocumentsHookMock = createTaskDocumentsHookMock();
    const taskCleanupImpactHookMock = createTaskCleanupImpactHookMock();

    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      allTasks: [task],
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
      taskDocumentsHook: taskDocumentsHookMock,
      taskCleanupImpactHook: taskCleanupImpactHookMock,
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.runWorkflowAction("close_task"));

      expect(harness.getLatest().isCloseDialogOpen).toBe(true);
      expect(onCloseTask).not.toHaveBeenCalled();

      await harness.run((viewModel) => viewModel.confirmClose());

      expect(onCloseTask).toHaveBeenCalledWith("TASK-1");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps close dialog open and surfaces close failures", async () => {
    const { useTaskDetailsSheetViewModel } = await import("./use-task-details-sheet-view-model");
    const task = createTaskCardFixture({ id: "TASK-2", title: "Task 2" });
    const onCloseTask = mock(async () => {
      throw new Error("close failed");
    });
    const taskDocumentsHookMock = createTaskDocumentsHookMock();
    const taskCleanupImpactHookMock = createTaskCleanupImpactHookMock();

    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      task,
      allTasks: [task],
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
      taskDocumentsHook: taskDocumentsHookMock,
      taskCleanupImpactHook: taskCleanupImpactHookMock,
      taskStopImpactHook: createTaskStopImpactHookMock(),
    });

    try {
      await harness.mount();
      await harness.run((viewModel) => viewModel.openCloseDialog());
      await harness.run((viewModel) => viewModel.confirmClose());

      expect(harness.getLatest().isCloseDialogOpen).toBe(true);
      expect(harness.getLatest().closeError).toBe("close failed");
    } finally {
      await harness.unmount();
    }
  });

  test("renders without the top-right close control", async () => {
    const { TaskDetailsSheet } = await import("./task-details-sheet");

    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
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
          allTasks: [task],
          open: true,
          onOpenChange: () => {},
        }),
      ),
    );

    expect(html).not.toContain('<span class="sr-only">Close</span>');
  });
});
