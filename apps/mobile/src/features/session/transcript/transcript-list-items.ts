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
 * reasoning text shows as its parts. The inverted list shows its items from the bottom of the screen, so it takes the rows
 * and the parts of each message in reverse order.
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
    const parts = partsOf(row);
    if (parts === null) {
      topItemOfRow[rowIndex] = items.length;
      add(row, rowIndex);
      return;
    }
    const ordered = kind === "latest" ? parts.toReversed() : parts;
    for (const part of ordered) add(part, rowIndex);
    topItemOfRow[rowIndex] = kind === "latest" ? items.length - 1 : items.length - parts.length;
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
 * null when no row is in view.
 */
export const topRowIndex = (
  kind: TranscriptListKind,
  list: TranscriptListItems,
  visibleListIndices: readonly number[],
): number | null => {
  if (visibleListIndices.length === 0 || list.topItemOfRow.length === 0) return null;
  // The inverted list shows its highest index at the top of the screen.
  const top = kind === "latest" ? Math.max(...visibleListIndices) : Math.min(...visibleListIndices);
  return list.rowOfItem[top] ?? null;
};
