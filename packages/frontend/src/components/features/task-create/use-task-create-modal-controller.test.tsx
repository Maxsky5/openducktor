import { describe, expect, mock, test } from "bun:test";
import { act, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { QueryProvider } from "@/lib/query-provider";
import {
  type TaskWorkflowTaskComposerModel,
  useTaskWorkflowComposer,
} from "@/features/task-workflow/use-task-workflow-composer";
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
import {
  type TaskCreateDestination,
  useTaskCreateModalController,
} from "./use-task-create-modal-controller";

const workspaceState = {
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
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    abbreviation: null,
    tileColor: null,
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: null,
    effectiveWorktreeBasePath: null,
  },
  branches: [],
  activeBranch: null,
  commitWorkspaceProviderSetup: async () => {
    throw new Error("Not used");
  },
  addWorkspace: async () => {
    throw new Error("Not used");
  },
  selectWorkspace: async () => {},
  reorderWorkspaces: async () => {},
  refreshBranches: async () => {},
  switchBranch: async () => {},
  loadRepoSettings: async () => {
    throw new Error("Not used in this test.");
  },
  saveRepoSettings: async () => {},
  saveWorkspaceModelDefaults: async () => {
    throw new Error("Not used");
  },
  loadSettingsSnapshot: async () => {
    throw new Error("Not used in this test.");
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
  createTask: TasksStateContextValue["createTask"] = async () => {},
): TasksStateContextValue => ({
  tasksAreCurrent: true,
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  detectingPullRequestTaskIds: new Set<string>(),
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskIds: new Set<string>(),
  pendingMergedPullRequest: null,
  tasks: [],
  refreshTasks: async () => {},
  syncPullRequests: async () => {},
  linkMergedPullRequest: async () => {},
  cancelLinkMergedPullRequest: () => {},
  unlinkPullRequest: async () => {},
  createTask,
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
  initialTask: ReturnType<typeof createTaskCardFixture> | null,
  updateTask: TasksStateContextValue["updateTask"],
  createTask: TasksStateContextValue["createTask"] = async () => {},
  destination: TaskCreateDestination | null = null,
  initialTitle = "",
) => {
  let latest: Controller | null = null;

  const Probe = ({ task }: { task: ReturnType<typeof createTaskCardFixture> | null }): null => {
    latest = useTaskCreateModalController({
      open: true,
      onOpenChange: () => {},
      tasks: task ? [task] : [],
      task,
      destination,
      initialTitle,
    });
    return null;
  };

  const providers = (children: ReactNode): ReactElement => (
    <QueryProvider useIsolatedClient>
      <WorkspaceStateContext.Provider value={workspaceState}>
        <TasksStateContext.Provider value={createTasksState(updateTask, createTask)}>
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
  test.each(["create", "edit"])(
    "locks a held %s request and restores the draft after failure",
    async (mode) => {
      let rejectRequest: ((reason: Error) => void) | undefined;
      const pendingRequest = new Promise<void>((_resolve, reject) => {
        rejectRequest = reject;
      });
      const createTask = mock(async () => pendingRequest);
      const updateTask = mock(async () => pendingRequest);
      const task = mode === "edit" ? createTaskCardFixture({ id: "task-1" }) : null;
      const harness = renderController(task, updateTask, createTask);
      try {
        act(() =>
          harness.getController().updateState({ title: "Draft", description: "Draft body" }),
        );
        let submission: Promise<void> | undefined;
        act(() => {
          submission = harness.getController().submit();
        });
        expect(harness.getController().isFormDisabled).toBe(true);
        expect(mode === "create" ? createTask : updateTask).toHaveBeenCalledTimes(1);

        await act(async () => {
          rejectRequest?.(new Error("Save failed"));
          await submission;
        });
        expect(harness.getController().isFormDisabled).toBe(false);
        expect(harness.getController().state.description).toBe("Draft body");
        expect(harness.getController().footerError).toBe("Save failed");
      } finally {
        harness.unmount();
      }
    },
  );

  test("creates a new task only in the workspace that was active when it opened", async () => {
    const createTask = mock(async () => {});
    const harness = renderController(null, async () => {}, createTask, {
      workspaceId: "workspace-2",
      workspaceName: "Other workspace",
    });
    try {
      act(() => harness.getController().updateState({ title: "Draft" }));
      expect(harness.getController().footerError).toBe(
        "This task is for Other workspace. Open Other workspace again to create it.",
      );

      await act(async () => {
        await harness.getController().submit();
      });

      expect(createTask).not.toHaveBeenCalled();
      expect(harness.getController().state.title).toBe("Draft");
    } finally {
      harness.unmount();
    }
  });

  test("creates a new task when its workspace is active", async () => {
    const createTask = mock(async () => {});
    const harness = renderController(null, async () => {}, createTask, {
      workspaceId: "workspace-1",
      workspaceName: "Workspace",
    });
    try {
      act(() => harness.getController().updateState({ title: "Draft" }));
      expect(harness.getController().footerError).toBeNull();

      await act(async () => {
        await harness.getController().submit();
      });

      expect(createTask).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  test("starts a new task with the requested title", () => {
    const harness = renderController(null, async () => {}, undefined, null, "Write docs");
    try {
      expect(harness.getController().state.title).toBe("Write docs");
      expect(harness.getController().step).toBe("type");
    } finally {
      harness.unmount();
    }
  });

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

describe("task workflow editor save ownership", () => {
  test.each(["another workspace", "the same task after returning"])(
    "keeps the replacement draft in %s when an old save completes",
    async (replacement) => {
      const taskA = createTaskCardFixture({ id: "task-a", title: "Task A" });
      const taskB = createTaskCardFixture({ id: "task-b", title: "Task B" });
      const workspaceA = workspaceState.activeWorkspace;
      const workspaceB = { ...workspaceA, workspaceId: "workspace-2", repoPath: "/other" };
      let resolveSave = (): void => {};
      const pendingSave = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      const updateTask = mock(async () => {
        await pendingSave;
      });
      let workflowComposer: ReturnType<typeof useTaskWorkflowComposer>;
      let controller: Controller;
      let submission: Promise<void> | undefined;
      const getComposer = () => workflowComposer;
      const getController = () => controller;
      type ProbeProps = {
        workspace: typeof workspaceA;
        task: typeof taskA;
      };

      const EditorProbe = ({ editor }: { editor: TaskWorkflowTaskComposerModel }): null => {
        controller = useTaskCreateModalController(editor);
        return null;
      };
      const ComposerProbe = ({ workspace, task }: ProbeProps): ReactElement | null => {
        workflowComposer = useTaskWorkflowComposer({ activeWorkspace: workspace, tasks: [task] });
        return workflowComposer.composer.open ? (
          <EditorProbe editor={workflowComposer.composer} />
        ) : null;
      };
      const tree = (workspace: typeof workspaceA, task: typeof taskA): ReactElement => (
        <QueryProvider useIsolatedClient>
          <WorkspaceStateContext.Provider value={{ ...workspaceState, activeWorkspace: workspace }}>
            <TasksStateContext.Provider value={{ ...createTasksState(updateTask), tasks: [task] }}>
              <SpecStateContext.Provider value={specState}>
                <ComposerProbe workspace={workspace} task={task} />
              </SpecStateContext.Provider>
            </TasksStateContext.Provider>
          </WorkspaceStateContext.Provider>
        </QueryProvider>
      );
      const view = render(tree(workspaceA, taskA));
      try {
        act(() => getComposer().onEdit(taskA.id));
        act(() => getController().updateState({ title: "Saved A" }));
        act(() => {
          submission = getController().submit();
        });
        expect(getController().isSubmitting).toBe(true);
        expect(updateTask).toHaveBeenCalledWith(
          taskA.id,
          expect.objectContaining({ title: "Saved A" }),
          undefined,
        );

        view.rerender(tree(workspaceB, taskB));
        expect(getComposer().composer.open).toBe(false);
        const nextTask = replacement === "another workspace" ? taskB : taskA;
        if (replacement !== "another workspace") {
          view.rerender(tree(workspaceA, taskA));
        }
        act(() => getComposer().onEdit(nextTask.id));
        act(() => getController().updateState({ title: "Unsaved replacement" }));
        await act(async () => {
          resolveSave();
          await submission;
        });
        expect(getComposer().composer.task?.id).toBe(nextTask.id);
        expect(getController().state.title).toBe("Unsaved replacement");
        expect(getController().isSubmitting).toBe(false);

        await act(async () => {
          await getController().submit();
        });
        expect(updateTask).toHaveBeenLastCalledWith(
          nextTask.id,
          expect.objectContaining({ title: "Unsaved replacement" }),
          undefined,
        );
        expect(getComposer().composer.open).toBe(false);
      } finally {
        await act(async () => {
          resolveSave();
          await submission;
        });
        view.unmount();
      }
    },
  );
});
