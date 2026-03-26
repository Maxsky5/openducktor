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
  activeRepo: "/repo-a",
  activeWorkspace: null,
  branches: [],
  activeBranch: null,
  addWorkspace: async () => {},
  selectWorkspace: async () => {},
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
  test("passes activeRepo into task details view model", async () => {
    const { useTaskDetailsSheetViewModel } = await import("./use-task-details-sheet-view-model");

    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Task 1",
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
    const taskDeleteImpactHookMock = mock(() => ({
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
      impactError: null,
      isLoadingImpact: false,
    }));

    const harness = createSharedHookHarness(useTaskDetailsSheetViewModel, {
      activeRepo: "/repo-a",
      task,
      allTasks: [task],
      open: true,
      onOpenChange: () => {},
      onPlan: undefined,
      onQaStart: undefined,
      onQaOpen: undefined,
      onBuild: undefined,
      onDelegate: undefined,
      onDefer: undefined,
      onResumeDeferred: undefined,
      onHumanApprove: undefined,
      onHumanRequestChanges: undefined,
      onResetImplementation: undefined,
      onDelete: undefined,
      taskDocumentsHook: taskDocumentsHookMock,
      taskDeleteImpactHook: taskDeleteImpactHookMock,
    });

    try {
      await harness.mount();
      expect(taskDocumentsHookMock).toHaveBeenCalledWith("TASK-1", true, "/repo-a");
      expect(taskDeleteImpactHookMock).toHaveBeenCalledWith(["TASK-1"], true);
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
          activeRepo: "/repo-a",
          task,
          allTasks: [task],
          runs: [],
          open: true,
          onOpenChange: () => {},
        }),
      ),
    );

    expect(html).not.toContain('<span class="sr-only">Close</span>');
  });
});
