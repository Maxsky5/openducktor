import { type IssueType, issueTypeSchema, type TaskPriority } from "@openducktor/contracts";
import {
  ISSUE_TYPE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_LEVELS,
} from "@openducktor/frontend-core/tasks/board/kanban-task-badge-model";
import type { KanbanBoardFilter } from "@openducktor/frontend-core/tasks/board/kanban-board-filter";

/** Adds a missing value or removes a present one, and keeps the order of the others. */
export const toggleFilterValue = <Value>(values: readonly Value[], value: Value): Value[] =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

/** The number of selected labels, issue types, and priorities. The search counts apart. */
export const selectedFilterCount = (filter: KanbanBoardFilter): number =>
  filter.labels.length + filter.issueTypes.length + filter.priorities.length;

/** The label of the Filters control, such as "Filters (2)". */
export const filtersControlLabel = (filter: KanbanBoardFilter): string => {
  const count = selectedFilterCount(filter);
  return count === 0 ? "Filters" : `Filters (${count})`;
};

/** The issue types in the order of the desktop Type menu. */
export const ISSUE_TYPE_FILTER_OPTIONS: readonly { value: IssueType; label: string }[] =
  issueTypeSchema.options.map((value) => ({ value, label: ISSUE_TYPE_LABELS[value] }));

/** The priorities with the words of the desktop Priority menu, such as "P0 Critical". */
export const PRIORITY_FILTER_OPTIONS: readonly {
  value: TaskPriority;
  label: string;
  accessibilityLabel: string;
}[] = PRIORITY_LEVELS.map((value) => ({
  value,
  label: `${PRIORITY_LABELS[value].label} ${PRIORITY_LABELS[value].hint}`,
  accessibilityLabel: `${PRIORITY_LABELS[value].label}, ${PRIORITY_LABELS[value].hint}`,
}));

/** The filter summary that a screen reader hears on the board. */
export const filterSummary = (matching: number, total: number): string =>
  matching === total ? `${total} tasks` : `${matching} of ${total} tasks match`;
