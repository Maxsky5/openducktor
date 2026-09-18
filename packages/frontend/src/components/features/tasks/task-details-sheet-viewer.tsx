import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { TaskDetailsSheet } from "@/components/features/task-details/task-details-sheet";
import { TaskDetailsSheetPlaceholder } from "@/components/features/task-details/task-details-sheet-placeholder";
import { useTaskSnapshotContext } from "@/state/app-state-contexts";
import { useActiveWorkspace } from "@/state/app-state-provider";
import { unfilteredRepoTaskDataQueryOptions } from "@/state/queries/tasks";

type TaskDetailsSheetViewerProps = {
  taskId: string;
  onOpenChange: (open: boolean) => void;
};

export default function TaskDetailsSheetViewer({
  taskId,
  onOpenChange,
}: TaskDetailsSheetViewerProps): ReactElement {
  const activeWorkspace = useActiveWorkspace();
  const { tasks, isLoadingTasks } = useTaskSnapshotContext();
  const contextTask = tasks.find((entry) => entry.id === taskId);
  const taskQuery = useQuery({
    ...unfilteredRepoTaskDataQueryOptions(activeWorkspace?.repoPath ?? ""),
    enabled: Boolean(activeWorkspace) && !contextTask && !isLoadingTasks,
    retry: false,
  });
  const allTasks = contextTask ? tasks : (taskQuery.data?.tasks ?? tasks);
  const task = contextTask ?? allTasks.find((entry) => entry.id === taskId);

  if (!task) {
    let error: string | undefined;
    if (!activeWorkspace) error = "Select a workspace to view this task.";
    else if (taskQuery.isError) error = taskQuery.error.message;
    else if (!isLoadingTasks && taskQuery.isSuccess)
      error = `Task ${taskId} no longer exists in this workspace.`;
    return (
      <TaskDetailsSheetPlaceholder onOpenChange={onOpenChange} {...(error ? { error } : {})} />
    );
  }

  return (
    <TaskDetailsSheet
      activeWorkspace={activeWorkspace}
      task={task}
      allTasks={allTasks}
      open
      onOpenChange={onOpenChange}
    />
  );
}
