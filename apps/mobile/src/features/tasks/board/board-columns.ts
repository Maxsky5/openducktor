import type { KanbanEmptyColumnDisplay, TaskCard } from "@openducktor/contracts";
import type { KanbanColumn, KanbanColumnId } from "@openducktor/core";

/**
 * The short name of each lane in the phone lane rail, where a lane has about 44 points. The lane
 * header under the rail shows the full desktop title.
 */
export const LANE_SHORT_LABELS = {
  open: "Backlog",
  spec_ready: "Spec",
  ready_for_dev: "Ready",
  in_progress: "Progress",
  blocked: "Blocked",
  ai_review: "AI QA",
  human_review: "Review",
  closed: "Done",
} as const satisfies Record<KanbanColumnId, string>;

/** A board column as the app shows it. */
export type BoardColumn = {
  id: KanbanColumnId;
  title: string;
  tasks: TaskCard[];
  /** The host Kanban setting shows this empty column as a narrow marker. */
  collapsed: boolean;
  /** Why an empty column is empty, when the filters or the Done setting explain it. */
  emptyMessage: string | null;
};

type BuildBoardColumnsInput = {
  /** The columns of the tasks that the search and filters keep, in desktop order. */
  columns: readonly KanbanColumn[];
  emptyColumnDisplay: KanbanEmptyColumnDisplay;
  /** How many days the host keeps Done tasks on the board. Zero hides them. */
  doneVisibleDays: number;
  /** True when the search or a filter hides tasks. */
  filterActive: boolean;
};

const doneEmptyMessage = (doneVisibleDays: number): string => {
  if (doneVisibleDays === 0) {
    return "The host Kanban setting hides Done tasks. Change it in the desktop or web app.";
  }
  const days = doneVisibleDays === 1 ? "1 day" : `${doneVisibleDays} days`;
  return `Done tasks show here for ${days} after they close.`;
};

const emptyMessage = (
  column: KanbanColumn,
  {
    doneVisibleDays,
    filterActive,
  }: Pick<BuildBoardColumnsInput, "doneVisibleDays" | "filterActive">,
): string | null => {
  if (filterActive) return "No task in this lane matches the search and filters.";
  if (column.id === "closed") return doneEmptyMessage(doneVisibleDays);
  return null;
};

/**
 * The visible columns. Empty columns follow the host Kanban setting: they show, collapse, or
 * hide. The host keeps Done tasks for its Done visibility setting, so the Done column shows only
 * the tasks that the host returns.
 */
export const buildBoardColumns = (input: BuildBoardColumnsInput): BoardColumn[] =>
  input.columns.flatMap((column) => {
    const empty = column.tasks.length === 0;
    if (empty && input.emptyColumnDisplay === "hidden") return [];
    return [
      {
        id: column.id,
        title: column.title,
        tasks: column.tasks,
        collapsed: empty && input.emptyColumnDisplay === "collapsed",
        emptyMessage: empty ? emptyMessage(column, input) : null,
      },
    ];
  });

/** The column to show on a phone: the chosen one while it is visible, else the first one. */
export const resolveSelectedColumnId = (
  columns: readonly BoardColumn[],
  chosen: KanbanColumnId | null,
): KanbanColumnId | null => {
  if (chosen !== null && columns.some((column) => column.id === chosen)) return chosen;
  return columns[0]?.id ?? null;
};

/** The accessible name of a column choice, such as "In Progress, 3 tasks". */
export const columnChoiceLabel = (column: Pick<BoardColumn, "title" | "tasks">): string =>
  `${column.title}, ${column.tasks.length === 1 ? "1 task" : `${column.tasks.length} tasks`}`;
