import type { TaskPriority } from "@openducktor/contracts";
import type {
  BuiltinIssueTypeId as IssueType,
  BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";

/** The search text and the filter selections of one workspace board. */
export type KanbanBoardFilter = {
  searchText: string;
  labels: readonly string[];
  issueTypes: readonly IssueType[];
  priorities: readonly TaskPriority[];
};

export const EMPTY_KANBAN_BOARD_FILTER: KanbanBoardFilter = {
  searchText: "",
  labels: [],
  issueTypes: [],
  priorities: [],
};

export const isKanbanBoardFilterActive = (filter: KanbanBoardFilter): boolean =>
  searchWords(filter.searchText).length > 0 ||
  filter.labels.length > 0 ||
  filter.issueTypes.length > 0 ||
  filter.priorities.length > 0;

/**
 * The tasks that match the search and every filter with a selection, in their input order.
 * Each search word must be part of the title, the ID, or one label. An empty selection matches all.
 */
export const filterKanbanTasks = (tasks: TaskCard[], filter: KanbanBoardFilter): TaskCard[] => {
  const words = searchWords(filter.searchText);
  const labels = new Set(filter.labels);
  const issueTypes = new Set(filter.issueTypes);
  const priorities = new Set(filter.priorities);

  return tasks.filter((task) => {
    if (labels.size > 0 && !task.labels.some((label) => labels.has(label))) return false;
    if (issueTypes.size > 0 && !issueTypes.has(task.issueType)) return false;
    if (priorities.size > 0 && !priorities.has(task.priority)) return false;
    if (words.length === 0) return true;

    const fields = [task.title, task.id, ...task.labels].map((field) => field.toLowerCase());
    return words.every((word) => fields.some((field) => field.includes(word)));
  });
};

/**
 * The labels of the loaded tasks and the selected labels, in alphabetical order.
 * A selected label stays when no loaded task has it, so the user can clear it.
 */
export const kanbanLabelOptions = (
  tasks: TaskCard[],
  selectedLabels: readonly string[],
): string[] =>
  Array.from(new Set([...tasks.flatMap((task) => task.labels), ...selectedLabels])).sort(
    (left, right) => left.localeCompare(right),
  );

const searchWords = (searchText: string): string[] =>
  searchText.trim().toLowerCase().split(/\s+/).filter(Boolean);
