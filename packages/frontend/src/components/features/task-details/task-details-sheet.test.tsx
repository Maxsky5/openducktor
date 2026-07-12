import { describe, expect, mock, test } from "bun:test";
import { createElement, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryProvider } from "@/lib/query-provider";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
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
});

const IsolatedProviders = ({ children }: PropsWithChildren) => (
  <QueryProvider useIsolatedClient>
    <WorkspaceStateContext.Provider value={createWorkspaceStateValue()}>
      {children}
    </WorkspaceStateContext.Provider>
  </QueryProvider>
);

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

    const taskDocumentsHookMock = mock(
      (_taskId: string | null, _open: boolean, _cacheScope = "") => ({
        specDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
        planDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
        qaDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
        ensureDocumentLoaded: () => false,
        reloadDocument: () => false,
        applyDocumentUpdate: () => {},
      }),
    );
    const taskCleanupImpactHookMock = mock(() => ({
      hasCanonicalWorktree: false,
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
      legacyWorktreeCount: 0,
      impactError: null,
      isLoadingImpact: false,
      terminalCount: 0,
    }));

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
    });

    try {
      await harness.mount();
      expect(taskDocumentsHookMock).toHaveBeenCalledWith("TASK-1", true, "/repo-a");
      expect(taskCleanupImpactHookMock).toHaveBeenNthCalledWith(1, ["TASK-1", "TASK-2"], true);
      expect(taskCleanupImpactHookMock).toHaveBeenNthCalledWith(2, ["TASK-1"], true);
    } finally {
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
    const taskDocumentsHookMock = mock(() => ({
      specDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
      planDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
      qaDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
      ensureDocumentLoaded: () => false,
      reloadDocument: () => false,
      applyDocumentUpdate: () => {},
    }));
    const taskCleanupImpactHookMock = mock(() => ({
      hasCanonicalWorktree: false,
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
      legacyWorktreeCount: 0,
      impactError: null,
      isLoadingImpact: false,
      terminalCount: 0,
    }));

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
    const taskDocumentsHookMock = mock(() => ({
      specDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
      planDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
      qaDoc: { markdown: "", updatedAt: null, isLoading: false, error: null, loaded: true },
      ensureDocumentLoaded: () => false,
      reloadDocument: () => false,
      applyDocumentUpdate: () => {},
    }));
    const taskCleanupImpactHookMock = mock(() => ({
      hasCanonicalWorktree: false,
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
      legacyWorktreeCount: 0,
      impactError: null,
      isLoadingImpact: false,
      terminalCount: 0,
    }));

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
