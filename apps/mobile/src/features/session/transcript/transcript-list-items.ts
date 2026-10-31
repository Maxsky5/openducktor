import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { MessagePartItem } from "./transcript-message-parts";

/**
 * The end of the transcript that a list starts at. A list measures the rows that it mounts and
 * estimates the others, so only the start of a list has an exact place. The `latest` list is
 * starts at the latest message, at the bottom of the screen. The `first` list starts at the first
 * message, at the top. Both show the rows in the same order.
 */
export type TranscriptListKind = "latest" | "first";

/** The space under the latest message. */
export type BottomEdgeItem = { readonly kind: "bottom_edge"; readonly key: string };

/**
 * The space or the notice above the first message. The cell reads the notice from
 * `TranscriptNoticeContext`, so a new notice changes no item of the list.
 */
export type TopEdgeItem = { readonly kind: "top_edge"; readonly key: string };

export type TranscriptListItem =
  | AgentChatTranscriptRow
  | MessagePartItem
  | BottomEdgeItem
  | TopEdgeItem;

/** The items of a list, and where each transcript row is in it. */
export type TranscriptListItems = {
  readonly items: readonly TranscriptListItem[];
  /** The transcript index of the row of each item. An edge takes the row next to it. */
  readonly rowOfItem: readonly number[];
  /** The index of the item that shows the top of each transcript row. */
  readonly topItemOfRow: readonly number[];
};

/** The parts of a long answer or reasoning row, or null for a row that shows whole. */
export type MessagePartsOf = (row: AgentChatTranscriptRow) => readonly MessagePartItem[] | null;

const BOTTOM_EDGE: BottomEdgeItem = { kind: "bottom_edge", key: "transcript:bottom-edge" };
const TOP_EDGE: TopEdgeItem = { kind: "top_edge", key: "transcript:top-edge" };

/**
 * The items of a list in content order, with an edge item at each end. A long answer or
 * reasoning text shows as its parts.
 */
export const transcriptListItems = (
  rows: readonly AgentChatTranscriptRow[],
  partsOf: MessagePartsOf,
): TranscriptListItems => {
  const lastRow = Math.max(0, rows.length - 1);
  const items: TranscriptListItem[] = [];
  const rowOfItem: number[] = [];
  const topItemOfRow = Array.from({ length: rows.length }, () => 0);
  const add = (item: TranscriptListItem, rowIndex: number): void => {
    items.push(item);
    rowOfItem.push(rowIndex);
  };
  const addRow = (rowIndex: number): void => {
    const row = rows[rowIndex];
    if (row === undefined) return;
    const parts = partsOf(row);
    topItemOfRow[rowIndex] = items.length;
    if (parts === null) add(row, rowIndex);
    else for (const part of parts) add(part, rowIndex);
  };
  add(TOP_EDGE, 0);
  for (let index = 0; index < rows.length; index += 1) addRow(index);
  add(BOTTOM_EDGE, lastRow);
  return { items, rowOfItem, topItemOfRow };
};

/**
 * The transcript index of the row at the top of the screen, from the list indices in view, or
 * null when no row is in view.
 */
export const topRowIndex = (
  list: TranscriptListItems,
  visibleListIndices: readonly number[],
): number | null => {
  if (visibleListIndices.length === 0 || list.topItemOfRow.length === 0) return null;
  return list.rowOfItem[Math.min(...visibleListIndices)] ?? null;
};
