import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import type {
  KanbanPageDetailsSheetModel,
  KanbanPageTaskComposerModel,
} from "./kanban-page-model-types";

type UseKanbanTaskDialogsArgs = {
  tasks: TaskCard[];
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onDefer: (taskId: string) => void;
  onResumeDeferred: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onDelete: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};

type UseKanbanTaskDialogsResult = {
  onCreateTask: () => void;
  onOpenDetails: (taskId: string) => void;
  taskComposer: KanbanPageTaskComposerModel;
  detailsSheet: KanbanPageDetailsSheetModel;
};

export function useKanbanTaskDialogs({
  tasks,
  onPlan,
  onBuild,
  onDelegate,
  onDefer,
  onResumeDeferred,
  onHumanApprove,
  onHumanRequestChanges,
  onDelete,
}: UseKanbanTaskDialogsArgs): UseKanbanTaskDialogsResult {
  const [isTaskComposerOpen, setTaskComposerOpen] = useState(false);
  const [composerTaskId, setComposerTaskId] = useState<string | null>(null);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);

  const detailsTask = useMemo(
    () => tasks.find((task) => task.id === detailsTaskId) ?? null,
    [detailsTaskId, tasks],
  );

  const composerTask = useMemo(
    () => tasks.find((task) => task.id === composerTaskId) ?? null,
    [composerTaskId, tasks],
  );

  const onCreateTask = useCallback((): void => {
    setComposerTaskId(null);
    setTaskComposerOpen(true);
  }, []);

  const onTaskComposerOpenChange = useCallback((nextOpen: boolean): void => {
    setTaskComposerOpen(nextOpen);
    if (!nextOpen) {
      setComposerTaskId(null);
    }
  }, []);

  const onOpenDetails = useCallback((taskId: string): void => {
    setDetailsTaskId(taskId);
  }, []);

  const onDetailsOpenChange = useCallback((open: boolean): void => {
    if (!open) {
      setDetailsTaskId(null);
    }
  }, []);

  const onEditTask = useCallback((taskId: string): void => {
    setDetailsTaskId(null);
    setComposerTaskId(taskId);
    setTaskComposerOpen(true);
  }, []);

  return {
    onCreateTask,
    onOpenDetails,
    taskComposer: {
      open: isTaskComposerOpen,
      task: composerTask,
      tasks,
      onOpenChange: onTaskComposerOpenChange,
    },
    detailsSheet: {
      task: detailsTask,
      allTasks: tasks,
      open: detailsTask !== null,
      onOpenChange: onDetailsOpenChange,
      onPlan,
      onBuild,
      onDelegate,
      onEdit: onEditTask,
      onDefer,
      onResumeDeferred,
      onHumanApprove,
      onHumanRequestChanges,
      onDelete,
    },
  };
}
