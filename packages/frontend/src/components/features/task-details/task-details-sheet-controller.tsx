import { useQuery } from "@tanstack/react-query";
import { type ReactElement, type Ref, useEffect, useImperativeHandle, useState } from "react";
import { toast } from "sonner";
import { useTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { unfilteredRepoTaskDataQueryOptions } from "@/state/queries/tasks";
import { TaskDetailsSheet } from "./task-details-sheet";
import type { TaskDetailsSheetProps } from "./task-details-sheet-types";

export type TaskDetailsSheetControllerHandle = {
  openTask: (taskId: string) => void;
  close: () => void;
};

type TaskDetailsSheetControllerProps = Omit<
  TaskDetailsSheetProps,
  "task" | "open" | "onOpenChange" | "onDelete"
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

  useImperativeHandle(
    ref,
    () => ({
      openTask: (nextTaskId: string) => {
        setDeletingTask(null);
        setTaskId(nextTaskId);
      },
      close: () => {
        setDeletingTask(null);
        setTaskId(null);
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
        }
      }}
    />
  );
}
