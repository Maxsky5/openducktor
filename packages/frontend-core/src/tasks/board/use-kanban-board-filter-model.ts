import { useMemo } from "react";
import { create } from "zustand";
import {
  EMPTY_KANBAN_BOARD_FILTER,
  filterKanbanTasks,
  isKanbanBoardFilterActive,
  type KanbanBoardFilter,
  kanbanLabelOptions,
} from "./kanban-board-filter";

export type KanbanBoardFilterModel = {
  value: KanbanBoardFilter;
  /** The labels of the loaded tasks and the selected labels, in alphabetical order. */
  labelOptions: readonly string[];
  isActive: boolean;
  isDisabled: boolean;
  onChange: (patch: Partial<KanbanBoardFilter>) => void;
  onClear: () => void;
};
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

/**
 * The board filter model of one workspace, and the loaded tasks that match it, in their input
 * order. Without a workspace, the model is disabled and its setters throw, because no control
 * can call them.
 */
export function useKanbanBoardFilterModel(workspaceId: string | null, tasks: TaskCard[]) {
  const value = useKanbanBoardFilterStore((store) => readFilter(store.filters, workspaceId));
  const update = useKanbanBoardFilterStore((store) => store.update);
  const isActive = isKanbanBoardFilterActive(value);
  const matchingTasks = useMemo(
    () => (isActive ? filterKanbanTasks(tasks, value) : tasks),
    [isActive, tasks, value],
  );
  const labelOptions = useMemo(
    () => kanbanLabelOptions(tasks, value.labels),
    [tasks, value.labels],
  );
  const filter = useMemo((): KanbanBoardFilterModel => {
    const onChange = (patch: Partial<KanbanBoardFilter>): void => {
      if (workspaceId === null) throw new Error("The Kanban board filter has no workspace.");
      update(workspaceId, patch);
    };
    return {
      value,
      labelOptions,
      isActive,
      isDisabled: workspaceId === null,
      onChange,
      onClear: () => onChange(EMPTY_KANBAN_BOARD_FILTER),
    };
  }, [isActive, labelOptions, update, value, workspaceId]);

  return { filter, matchingTasks };
}

/**
 * The board filter of each workspace. It stays in app memory, so page and workspace changes keep
 * it, and an app restart clears it.
 */
type KanbanBoardFilterStore = {
  filters: Record<string, KanbanBoardFilter>;
  update: (workspaceId: string, patch: Partial<KanbanBoardFilter>) => void;
};

export const useKanbanBoardFilterStore = create<KanbanBoardFilterStore>()((set) => ({
  filters: {},
  update: (workspaceId, patch) =>
    set((store) => ({
      filters: {
        ...store.filters,
        [workspaceId]: { ...readFilter(store.filters, workspaceId), ...patch },
      },
    })),
}));

const readFilter = (
  filters: Record<string, KanbanBoardFilter>,
  workspaceId: string | null,
): KanbanBoardFilter =>
  workspaceId === null
    ? EMPTY_KANBAN_BOARD_FILTER
    : (filters[workspaceId] ?? EMPTY_KANBAN_BOARD_FILTER);
