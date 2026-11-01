import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { MessagePartItem } from "./transcript-message-parts";

/**
 * The end of the transcript that a list starts at. A list measures the rows that it mounts and
 * estimates the others, so only the start of a list has an exact place. The `latest` list is
 * inverted: it starts at the latest message, at the bottom of the screen. The `first` list starts
 * at the first message, at the top.
 */
export type TranscriptListKind = "latest" | "first";

/**
 * The space under the latest message. In the `latest` list it is the first item, so while the
 * reader is at the latest message, the list keeps it in place: new rows and a growing reply push
 * the rows above up, and the latest message stays in view.
 */
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
 * The items of a list in its content order, with an edge item at each end. A long answer or
 * reasoning text shows as its parts. The inverted list shows its items from the bottom of the
 * screen, so it takes the rows and the parts of each message in reverse order.
 */
export const transcriptListItems = (
  kind: TranscriptListKind,
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
    const start = items.length;
    const parts = partsOf(row);
    if (parts === null) {
      add(row, rowIndex);
    } else if (kind === "latest") {
      for (let index = parts.length - 1; index >= 0; index -= 1) add(parts[index]!, rowIndex);
    } else {
      for (const part of parts) add(part, rowIndex);
    }
    // The top of a row is its first part, which the inverted list adds last.
    topItemOfRow[rowIndex] = kind === "latest" ? items.length - 1 : start;
  };
  if (kind === "latest") {
    add(BOTTOM_EDGE, lastRow);
    for (let index = rows.length - 1; index >= 0; index -= 1) addRow(index);
    add(TOP_EDGE, 0);
  } else {
    add(TOP_EDGE, 0);
    for (let index = 0; index < rows.length; index += 1) addRow(index);
    add(BOTTOM_EDGE, lastRow);
  }
  return { items, rowOfItem, topItemOfRow };
};

/**
 * The transcript index of the row at the top of the screen, from the list indices in view, or
 * null when no row is in view. Both lists show the rows in transcript order from the top of the
 * screen, so it is the lowest row in view.
 */
export const topRowIndex = (
  list: TranscriptListItems,
  visibleListIndices: readonly number[],
): number | null => {
  if (list.topItemOfRow.length === 0) return null;
  let top: number | null = null;
  for (const index of visibleListIndices) {
    const row = list.rowOfItem[index];
    if (row !== undefined && (top === null || row < top)) top = row;
  }
  return top;
};
