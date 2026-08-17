import { describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { QueryProvider } from "@/lib/query-provider";
import {
  SpecStateContext,
  TasksStateContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import type {
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { useTaskCreateModalController } from "./use-task-create-modal-controller";

const workspaceState = {
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [],
  activeWorkspace: {
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: null,
    effectiveWorktreeBasePath: null,
  },
  branches: [],
  activeBranch: null,
  addWorkspace: async () => {},
  selectWorkspace: async () => {},
  reorderWorkspaces: async () => {},
  refreshBranches: async () => {},
  switchBranch: async () => {},
  loadRepoSettings: async () => {
    throw new Error("Not used in this test.");
  },
  saveRepoSettings: async () => {},
  loadSettingsSnapshot: async () => {
    throw new Error("Not used in this test.");
  },
  detectGithubRepository: async () => null,
  saveGlobalGitConfig: async () => {},
  saveSettingsSnapshot: async () => {},
  saveAgentModelFavorites: async () => {
    throw new Error("saveAgentModelFavorites is not used in this test");
  },
} satisfies WorkspaceStateContextValue;

const specState = {
  loadSpec: async () => "",
  loadSpecDocument: async () => ({ markdown: "", updatedAt: null }),
  loadPlanDocument: async () => ({ markdown: "", updatedAt: null }),
  loadQaReportDocument: async () => ({ markdown: "", updatedAt: null }),
  saveSpec: async () => ({ updatedAt: "2026-07-25T10:00:00.000Z" }),
  saveSpecDocument: async () => ({ updatedAt: "2026-07-25T10:00:00.000Z" }),
  savePlanDocument: async () => ({ updatedAt: "2026-07-25T10:00:00.000Z" }),
} satisfies SpecStateContextValue;

const createTasksState = (
  updateTask: TasksStateContextValue["updateTask"],
): TasksStateContextValue => ({
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  detectingPullRequestTaskId: null,
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskId: null,
  pendingMergedPullRequest: null,
  tasks: [],
  refreshTasks: async () => {},
  syncPullRequests: async () => {},
  linkMergedPullRequest: async () => {},
  cancelLinkMergedPullRequest: () => {},
  unlinkPullRequest: async () => {},
  createTask: async () => {},
  updateTask,
  setTaskTargetBranch: async () => {},
  deleteTask: async () => {},
  closeTask: async () => {},
  resetTaskImplementation: async () => {},
  resetTask: async () => {},
  transitionTask: async () => {},
  humanApproveTask: async () => {},
  humanRequestChangesTask: async () => {},
});

type Controller = ReturnType<typeof useTaskCreateModalController>;

const renderController = (
  initialTask: ReturnType<typeof createTaskCardFixture>,
  updateTask: TasksStateContextValue["updateTask"],
) => {
  let latest: Controller | null = null;

  const Probe = ({ task }: { task: ReturnType<typeof createTaskCardFixture> }): null => {
    latest = useTaskCreateModalController({
      open: true,
      onOpenChange: () => {},
      tasks: [task],
      task,
    });
    return null;
  };

  const providers = (children: ReactNode): ReactElement => (
    <QueryProvider useIsolatedClient>
      <WorkspaceStateContext.Provider value={workspaceState}>
        <TasksStateContext.Provider value={createTasksState(updateTask)}>
          <SpecStateContext.Provider value={specState}>{children}</SpecStateContext.Provider>
        </TasksStateContext.Provider>
      </WorkspaceStateContext.Provider>
    </QueryProvider>
  );

  const view = render(providers(<Probe task={initialTask} />));
  return {
    getController: (): Controller => {
      if (!latest) {
        throw new Error("Controller did not render.");
      }
      return latest;
    },
    replaceTask: (task: ReturnType<typeof createTaskCardFixture>): void => {
      view.rerender(providers(<Probe task={task} />));
    },
    unmount: view.unmount,
  };
};

describe("useTaskCreateModalController", () => {
  test("rehydrates an untouched draft when the open task changes with the same ID", async () => {
    const original = createTaskCardFixture({
      id: "task-1",
      title: "Original",
      description: "Original description",
    });
    const replacement = createTaskCardFixture(original, {
      title: "Updated",
      description: "Updated description",
      updatedAt: "2026-07-25T11:00:00.000Z",
    });
    const harness = renderController(original, async () => {});

    await act(async () => {
      harness.replaceTask(replacement);
    });

    expect(harness.getController().state.title).toBe("Updated");
    expect(harness.getController().state.description).toBe("Updated description");
    expect(harness.getController().footerError).toBeNull();
    harness.unmount();
  });

  test("keeps a dirty draft and blocks saving after a same-task external change", async () => {
    const updateCalls: string[] = [];
    const original = createTaskCardFixture({
      id: "task-1",
      title: "Original",
      description: "Original description",
    });
    const replacement = createTaskCardFixture(original, {
      description: "Changed elsewhere",
      updatedAt: "2026-07-25T11:00:00.000Z",
    });
    const harness = renderController(original, async (taskId) => {
      updateCalls.push(taskId);
    });

    act(() => {
      harness.getController().updateState({ description: "Local draft" });
    });
    await act(async () => {
      harness.replaceTask(replacement);
    });

    expect(harness.getController().state.description).toBe("Local draft");
    expect(harness.getController().footerError).toBe(
      "This task changed while you were editing. Close and reopen it to load the latest version before saving.",
    );
    await act(async () => {
      await harness.getController().submit();
    });
    expect(updateCalls).toEqual([]);
    harness.unmount();
  });
});
