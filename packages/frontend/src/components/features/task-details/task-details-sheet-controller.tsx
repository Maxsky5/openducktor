import { useQuery } from "@tanstack/react-query";
import {
  type ReactElement,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
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
  "task" | "open" | "onOpenChange"
> & {
  ref?: Ref<TaskDetailsSheetControllerHandle>;
};

export function TaskDetailsSheetController(props: TaskDetailsSheetControllerProps): ReactElement {
  return <WorkspaceTaskDetailsSheetController key={props.activeWorkspace?.repoPath} {...props} />;
}

function WorkspaceTaskDetailsSheetController(props: TaskDetailsSheetControllerProps): ReactElement {
  const { allTasks, ref, ...sheetProps } = props;
  const workflowActions = useTaskWorkflowActions();
  const deleteTask = sheetProps.onDelete ?? workflowActions?.onDelete;
  const repoPath = sheetProps.activeWorkspace?.repoPath ?? null;
  const [taskId, setTaskId] = useState<string | null>(null);
  const deletingTaskIdRef = useRef<string | null>(null);
  const boardTask = allTasks.find((entry) => entry.id === taskId);
  const taskQuery = useQuery({
    ...unfilteredRepoTaskDataQueryOptions(repoPath ?? ""),
    enabled: repoPath !== null && taskId !== null && !boardTask,
  });
  const sheetTasks = boardTask || !taskQuery.isSuccess ? allTasks : taskQuery.data.tasks;
  const task = sheetTasks.find((entry) => entry.id === taskId) ?? null;
  useEffect(() => {
    if (!taskId || boardTask || taskQuery.isFetching || taskQuery.isPending) return;
    if (taskQuery.isSuccess && taskQuery.data.tasks.some((entry) => entry.id === taskId)) return;
    if (taskQuery.isSuccess && deletingTaskIdRef.current === taskId) return;
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
        deletingTaskIdRef.current = null;
        setTaskId(nextTaskId);
      },
      close: () => {
        deletingTaskIdRef.current = null;
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
          deletingTaskIdRef.current = deletedTaskId;
          try {
            await deleteTask(deletedTaskId, options);
            setTaskId((currentTaskId) => (currentTaskId === deletedTaskId ? null : currentTaskId));
          } catch (error) {
            deletingTaskIdRef.current = null;
            throw error;
          }
        },
      })}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          deletingTaskIdRef.current = null;
          setTaskId(null);
        }
      }}
    />
  );
}
