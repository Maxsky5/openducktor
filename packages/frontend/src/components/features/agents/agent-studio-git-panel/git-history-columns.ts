import { z } from "zod";
import { create } from "zustand";
import { GRAPH_ACCENT_WIDTH } from "./git-history-graph";

export const HISTORY_COLUMN_IDS = ["refs", "graph", "message", "author", "date", "sha"] as const;
export type HistoryColumnId = (typeof HISTORY_COLUMN_IDS)[number];

/** The label and width of each column. The message column takes the free width. */
export const HISTORY_COLUMNS = {
  refs: { label: "Branch / Tag", width: 128 },
  graph: { label: "Graph", width: null },
  message: { label: "Commit message", width: null },
  author: { label: "Author", width: 120 },
  // The columns button covers the end of the last title, so a short column keeps room for it.
  date: { label: "Date", width: 64 },
  sha: { label: "SHA", width: 68 },
} satisfies Record<HistoryColumnId, { label: string; width: number | null }>;

/** The message names the commit, so it always shows. */
export const LOCKED_HISTORY_COLUMN: HistoryColumnId = "message";

export type HistoryColumnsState = { order: HistoryColumnId[]; hidden: HistoryColumnId[] };

/** The author and the SHA start hidden, so the commit message keeps its width. */
export const DEFAULT_HISTORY_COLUMNS: HistoryColumnsState = {
  order: [...HISTORY_COLUMN_IDS],
  hidden: ["author", "sha"],
};

export const HISTORY_COLUMNS_STORAGE_KEY = "openducktor:git-panel:history-columns:v1";

const columnIdSchema = z.enum(HISTORY_COLUMN_IDS);
const savedColumnsSchema = z.object({
  order: z.array(columnIdSchema),
  hidden: z.array(columnIdSchema),
});

/**
 * Keeps each column once and adds a column that a saved order does not know at its default
 * place, so a later release can add a column without losing the saved order.
 */
export function normalizeHistoryColumns(state: HistoryColumnsState): HistoryColumnsState {
  const order = [...new Set(state.order)];
  const known = new Set(order);
  for (const [index, id] of HISTORY_COLUMN_IDS.entries()) {
    if (!known.has(id)) order.splice(Math.min(index, order.length), 0, id);
  }
  const hidden = [...new Set(state.hidden)].filter((id) => id !== LOCKED_HISTORY_COLUMN);
  return { order, hidden };
}

/** Moves a column to the place of another column. */
export function moveHistoryColumn(
  order: readonly HistoryColumnId[],
  id: HistoryColumnId,
  toIndex: number,
): HistoryColumnId[] {
  const next = order.filter((entry) => entry !== id);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id);
  return next;
}

/** The width of a column cell. The graph column follows the shown lanes, and the message fills the row. */
export const historyColumnWidth = (id: HistoryColumnId, graphWidth: number): number | null =>
  id === "graph" ? graphWidth + GRAPH_ACCENT_WIDTH : HISTORY_COLUMNS[id].width;

/**
 * The left edge of a column in a row of `rowWidth`. The message column takes the width that the
 * fixed columns leave.
 */
export function historyColumnLeft(
  columns: readonly HistoryColumnId[],
  target: HistoryColumnId,
  graphWidth: number,
  rowWidth: number,
): number {
  const fixed = columns.reduce((sum, id) => sum + (historyColumnWidth(id, graphWidth) ?? 0), 0);
  let left = 0;
  for (const id of columns) {
    if (id === target) return left;
    left += historyColumnWidth(id, graphWidth) ?? Math.max(0, rowWidth - fixed);
  }
  return left;
}

export const visibleHistoryColumns = (state: HistoryColumnsState): HistoryColumnId[] => {
  const hidden = new Set(state.hidden);
  return state.order.filter((id) => !hidden.has(id));
};

export function readHistoryColumns(): HistoryColumnsState {
  try {
    const saved = globalThis.localStorage.getItem(HISTORY_COLUMNS_STORAGE_KEY);
    if (saved === null) return DEFAULT_HISTORY_COLUMNS;
    const parsed = savedColumnsSchema.safeParse(JSON.parse(saved));
    if (!parsed.success) throw new Error("The saved History columns are invalid.");
    return normalizeHistoryColumns(parsed.data);
  } catch (error) {
    console.error("[git-panel] Failed to read the History columns.", { error });
    return DEFAULT_HISTORY_COLUMNS;
  }
}

type HistoryColumnsStore = HistoryColumnsState & {
  toggle: (id: HistoryColumnId) => void;
  move: (id: HistoryColumnId, toIndex: number) => void;
  reset: () => void;
};

const save = (state: HistoryColumnsState): void => {
  try {
    globalThis.localStorage.setItem(HISTORY_COLUMNS_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("[git-panel] Failed to save the History columns.", { error });
  }
};

/** One device preference for every History view in the renderer. */
export const useHistoryColumnsStore = create<HistoryColumnsStore>()((set, get) => {
  const update = (state: HistoryColumnsState): void => {
    const next = normalizeHistoryColumns(state);
    set(next);
    save(next);
  };
  return {
    ...readHistoryColumns(),
    toggle: (id) => {
      if (id === LOCKED_HISTORY_COLUMN) return;
      const { order, hidden } = get();
      update({
        order,
        hidden: hidden.includes(id) ? hidden.filter((entry) => entry !== id) : [...hidden, id],
      });
    },
    move: (id, toIndex) => {
      const { order, hidden } = get();
      update({ order: moveHistoryColumn(order, id, toIndex), hidden });
    },
    reset: () => update(DEFAULT_HISTORY_COLUMNS),
  };
});
