import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  type TaskWorkflowTaskComposerModel,
  useTaskWorkflowComposer,
} from "@/features/task-workflow/use-task-workflow-composer";
import {
  ActiveWorkspaceContext,
  DocumentStateContext,
  TasksStateContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { TaskWorkflowActionsContext } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { WorkflowArtifactControls } from "@/components/features/task-artifacts/artifact-controls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  createTaskCardFixture,
  createTaskWorkflowActionsFixture,
} from "@/test-utils/shared-test-fixtures";
import type {
  DocumentStateContextValue,
  TasksStateContextValue,
} from "@openducktor/frontend-core/types/state-slices";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { useTaskCreateModalController } from "./use-task-create-modal-controller";

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

const documentState = {
  loadDocument: async () => ({ markdown: "", updatedAt: null }),
  saveDocument: async () => ({ updatedAt: "2026-07-25T10:00:00.000Z" }),
} satisfies DocumentStateContextValue;

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
  removeTaskWorktree: async () => {},
  resetTaskImplementation: async () => {},
  resetTask: async () => {},
  transitionTask: async () => {},
  humanRequestChangesTask: async () => {},
});

type Controller = ReturnType<typeof useTaskCreateModalController>;

describe("workflow artifact editor shortcuts", () => {
  test.each([
    { section: "spec", label: "Spec", markdown: "# Saved specification" },
    { section: "plan", label: "Plan", markdown: "# Saved implementation plan" },
  ] as const)(
    "opens $label directly and returns ordinary Edit to Details",
    async ({ section, label, markdown }) => {
      const task = createTaskCardFixture({ id: "task-edit-shortcut" });
      const tasks = [task];
      const workspace = workspaceState.activeWorkspace;
      let controller: Controller;
      const getController = () => controller;
      const documents = {
        ...documentState,
        loadDocument: async (_taskId: string, code: string) => ({
          markdown: code === "spec" ? "# Saved specification" : "# Saved implementation plan",
          updatedAt: null,
        }),
      };
      const ControllerProbe = ({ editor }: { editor: TaskWorkflowTaskComposerModel }): null => {
        controller = useTaskCreateModalController(editor);
        return null;
      };
      const EditorFlow = (): ReactElement => {
        const workflow = useTaskWorkflowComposer({ activeWorkspace: workspace, tasks });
        return (
          <TaskWorkflowActionsContext.Provider value={createTaskWorkflowActionsFixture(workflow)}>
            <TooltipProvider>
              <WorkflowArtifactControls
                taskId={task.id}
                workflowCode={section}
                name={label}
                markdown={undefined}
                taskAssetContext={undefined}
              />
            </TooltipProvider>
            <button type="button" onClick={() => workflow.onEdit(task.id)}>
              Edit task
            </button>
            <ControllerProbe editor={workflow.composer} />
          </TaskWorkflowActionsContext.Provider>
        );
      };
      const view = render(
        <QueryProvider>
          <WorkspaceStateContext.Provider value={workspaceState}>
            <ActiveWorkspaceContext.Provider
              value={{ activeWorkspace: workspace, setActiveWorkspace: () => {} }}
            >
              <TasksStateContext.Provider value={createTasksState(async () => {})}>
                <DocumentStateContext.Provider value={documents}>
                  <EditorFlow />
                </DocumentStateContext.Provider>
              </TasksStateContext.Provider>
            </ActiveWorkspaceContext.Provider>
          </WorkspaceStateContext.Provider>
        </QueryProvider>,
      );
      try {
        await act(async () => fireEvent.click(view.getByRole("button", { name: "Edit" })));
        expect(getController().editSection).toBe(section);
        expect(getController().activeDocumentSection).toBe(section);
        expect(getController().activeDraft).toBe(markdown);

        await act(async () => getController().close());
        await act(async () => fireEvent.click(view.getByRole("button", { name: "Edit task" })));
        expect(getController().editSection).toBe("details");
        expect(getController().activeDocumentSection).toBeNull();
      } finally {
        view.unmount();
      }
    },
  );
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
        <QueryProvider>
          <WorkspaceStateContext.Provider value={{ ...workspaceState, activeWorkspace: workspace }}>
            <ActiveWorkspaceContext.Provider
              value={{ activeWorkspace: workspace, setActiveWorkspace: () => {} }}
            >
              <TasksStateContext.Provider
                value={{ ...createTasksState(updateTask), tasks: [task] }}
              >
                <DocumentStateContext.Provider value={documentState}>
                  <ComposerProbe workspace={workspace} task={task} />
                </DocumentStateContext.Provider>
              </TasksStateContext.Provider>
            </ActiveWorkspaceContext.Provider>
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
