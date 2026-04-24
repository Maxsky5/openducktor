import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import type { KanbanPageTaskComposerModel } from "./kanban-page-model-types";

type UseKanbanTaskDialogsArgs = {
  tasks: TaskCard[];
};

type UseKanbanTaskDialogsResult = {
  onCreateTask: () => void;
  onEditTask: (taskId: string) => void;
  taskComposer: KanbanPageTaskComposerModel;
};

export function useKanbanTaskDialogs({
  tasks,
}: UseKanbanTaskDialogsArgs): UseKanbanTaskDialogsResult {
  const [isTaskComposerOpen, setTaskComposerOpen] = useState(false);
  const [composerTaskId, setComposerTaskId] = useState<string | null>(null);

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

  const onEditTask = useCallback((taskId: string): void => {
    setComposerTaskId(taskId);
    setTaskComposerOpen(true);
  }, []);

  return {
    onCreateTask,
    onEditTask,
    taskComposer: {
      open: isTaskComposerOpen,
      task: composerTask,
      tasks,
      onOpenChange: onTaskComposerOpenChange,
    },
  };
}
