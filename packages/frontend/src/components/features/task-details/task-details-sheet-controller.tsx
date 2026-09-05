import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { type ReactElement, type Ref, useEffect, useImperativeHandle, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { unfilteredRepoTaskDataQueryOptions } from "@/state/queries/tasks";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";
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
  allTasks: TaskCard[];
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  historicalSessionsByTaskId: Map<string, AgentSessionRecord[]>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  onOpenSession?: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  ref?: Ref<TaskDetailsSheetControllerHandle>;
};

export function TaskDetailsSheetController(props: TaskDetailsSheetControllerProps): ReactElement {
  return <WorkspaceTaskDetailsSheetController key={props.activeWorkspace?.repoPath} {...props} />;
}

function WorkspaceTaskDetailsSheetController(props: TaskDetailsSheetControllerProps): ReactElement {
  const {
    allTasks,
    taskSessionsByTaskId,
    historicalSessionsByTaskId,
    activeTaskSessionContextByTaskId,
    ref,
    ...sheetProps
  } = props;
  const repoPath = sheetProps.activeWorkspace?.repoPath ?? null;
  const [taskId, setTaskId] = useState<string | null>(null);
  const boardTask = allTasks.find((entry) => entry.id === taskId);
  const taskQuery = useQuery({
    ...unfilteredRepoTaskDataQueryOptions(repoPath ?? ""),
    enabled: repoPath !== null && taskId !== null && !boardTask,
  });
  const task =
    boardTask ??
    (taskId ? taskQuery.data?.tasks.find((entry) => entry.id === taskId) : null) ??
    null;
  useEffect(() => {
    if (!taskId || taskQuery.isFetching || taskQuery.isPending) return;
    if (taskQuery.data?.tasks.some((entry) => entry.id === taskId)) return;
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
    repoPath,
    taskId,
    taskQuery.data,
    taskQuery.isError,
    taskQuery.isFetching,
    taskQuery.isPending,
  ]);
  const open = task !== null;

  useImperativeHandle(
    ref,
    () => ({
      openTask: (nextTaskId: string) => {
        setTaskId(nextTaskId);
      },
      close: () => {
        setTaskId(null);
      },
    }),
    [],
  );

  const activeTaskId = task ? taskId : null;
  const selectedTaskSessions = activeTaskId ? (taskSessionsByTaskId.get(activeTaskId) ?? []) : [];
  const selectedHistoricalSessions = activeTaskId
    ? (historicalSessionsByTaskId.get(activeTaskId) ?? [])
    : [];
  const selectedActiveSessionContext = activeTaskId
    ? activeTaskSessionContextByTaskId.get(activeTaskId)
    : undefined;

  return (
    <TaskDetailsSheet
      {...sheetProps}
      task={task}
      allTasks={allTasks}
      taskSessions={selectedTaskSessions}
      historicalSessions={selectedHistoricalSessions}
      hasActiveSession={Boolean(selectedActiveSessionContext)}
      {...(selectedActiveSessionContext?.role
        ? { activeSessionRole: selectedActiveSessionContext.role }
        : {})}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setTaskId(null);
        }
      }}
    />
  );
}
