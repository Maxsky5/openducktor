import { useQuery } from "@tanstack/react-query";
import {
  type ReactElement,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { toast } from "sonner";
import { recordRecentItem } from "@/features/command-palette/recent-items";
import { useTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { unfilteredRepoTaskDataQueryOptions } from "@/state/queries/tasks";
import { TaskDetailsSheet } from "./task-details-sheet";
import type { TaskDetailsConfirm, TaskDetailsSheetProps } from "./task-details-sheet-types";

export type TaskDetailsSheetControllerHandle = {
  /** Open the task. `confirm` also opens that confirmation in the sheet. */
  openTask: (taskId: string, confirm?: TaskDetailsConfirm | null) => void;
  close: () => void;
};

type TaskDetailsSheetControllerProps = Omit<
  TaskDetailsSheetProps,
  "task" | "open" | "onOpenChange" | "onDelete" | "requestedConfirm" | "onRequestedConfirmHandled"
> & {
  ref?: Ref<TaskDetailsSheetControllerHandle>;
};

export function TaskDetailsSheetController(props: TaskDetailsSheetControllerProps): ReactElement {
  return <WorkspaceTaskDetailsSheetController key={props.activeWorkspace?.repoPath} {...props} />;
}

function WorkspaceTaskDetailsSheetController(props: TaskDetailsSheetControllerProps): ReactElement {
  const { allTasks, ref, ...sheetProps } = props;
  const workflowActions = useTaskWorkflowActions();
  const deleteTask = workflowActions?.onDelete;
  const repoPath = sheetProps.activeWorkspace?.repoPath ?? null;
  const [taskId, setTaskId] = useState<string | null>(null);
  const [requestedConfirm, setRequestedConfirm] = useState<{
    taskId: string;
    confirm: TaskDetailsConfirm;
  } | null>(null);
  const [deletingTask, setDeletingTask] = useState<{
    id: string;
    task: TaskDetailsSheetProps["task"];
  } | null>(null);
  const boardTask = allTasks.find((entry) => entry.id === taskId);
  const taskQuery = useQuery({
    ...unfilteredRepoTaskDataQueryOptions(repoPath ?? ""),
    enabled: repoPath !== null && taskId !== null && !boardTask,
  });
  const sheetTasks = boardTask || !taskQuery.isSuccess ? allTasks : taskQuery.data.tasks;
  const task =
    sheetTasks.find((entry) => entry.id === taskId) ??
    (deletingTask?.id === taskId ? deletingTask.task : null);
  useEffect(() => {
    if (!taskId || boardTask || taskQuery.isFetching || taskQuery.isPending) return;
    if (taskQuery.isSuccess && taskQuery.data.tasks.some((entry) => entry.id === taskId)) return;
    if (deletingTask?.id === taskId) return;
    toast.error(
      taskQuery.isError ? "Could not load notification task" : "Notification task no longer exists",
      {
        id: `task-details-unavailable:${repoPath}:${taskId}`,
        description: taskQuery.isError
          ? "Reload and open the task again."
          : "The task was removed from this workspace.",
      },
    );
  }, [
    boardTask,
    deletingTask,
    repoPath,
    taskId,
    taskQuery.data,
    taskQuery.isError,
    taskQuery.isFetching,
    taskQuery.isPending,
    taskQuery.isSuccess,
  ]);
  const open = task !== null;
  const shownTaskId = task?.id ?? null;
  const workspaceId = sheetProps.activeWorkspace?.workspaceId ?? null;
  useEffect(() => {
    if (shownTaskId && workspaceId)
      recordRecentItem({ kind: "task", workspaceId, taskId: shownTaskId });
  }, [shownTaskId, workspaceId]);
  const clearRequestedConfirm = useCallback(() => setRequestedConfirm(null), []);

  useImperativeHandle(
    ref,
    () => ({
      openTask: (nextTaskId, confirm) => {
        setDeletingTask(null);
        setTaskId(nextTaskId);
        setRequestedConfirm(confirm ? { taskId: nextTaskId, confirm } : null);
      },
      close: () => {
        setDeletingTask(null);
        setTaskId(null);
        setRequestedConfirm(null);
      },
    }),
    [],
  );

  return (
    <TaskDetailsSheet
      {...sheetProps}
      task={task}
      allTasks={sheetTasks}
      open={open}
      // A closing sheet can still show the previous task, so the request waits for its own task.
      requestedConfirm={requestedConfirm?.taskId === shownTaskId ? requestedConfirm.confirm : null}
      onRequestedConfirmHandled={clearRequestedConfirm}
      {...(deleteTask && {
        onDelete: async (deletedTaskId: string, options: { deleteSubtasks: boolean }) => {
          setDeletingTask({ id: deletedTaskId, task });
          try {
            await deleteTask(deletedTaskId, options);
            setTaskId((currentTaskId) => (currentTaskId === deletedTaskId ? null : currentTaskId));
            setDeletingTask((current) => (current?.id === deletedTaskId ? null : current));
          } catch (error) {
            setDeletingTask((current) => (current?.id === deletedTaskId ? null : current));
            throw error;
          }
        },
      })}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setDeletingTask(null);
          setTaskId(null);
          setRequestedConfirm(null);
        }
      }}
    />
  );
}
