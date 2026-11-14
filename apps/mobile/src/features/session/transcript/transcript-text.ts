import { readMessageTimeLabel } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";

/** The most characters that one tool text block shows. Longer text keeps a copy action. */
export const MAX_DISPLAY_CHARACTERS = 20_000;

/** The diff lines that a file edit shows inside the transcript. The full diff opens in a sheet. */
export const MAX_INLINE_DIFF_ROWS = 12;

/**
 * The rows that a transcript cell shows and the count it leaves out. A cell renders all of its
 * rows at once, so the full diff opens in a separate list.
 */
export type InlineDiffPreview<Row> = { previewRows: readonly Row[]; hidden: number };

export const inlineDiffPreview = <Row>(rows: readonly Row[]): InlineDiffPreview<Row> => {
  const previewRows = rows.slice(0, MAX_INLINE_DIFF_ROWS);
  return { previewRows, hidden: rows.length - previewRows.length };
};

/** The first lines of a text, and the count of lines it leaves out. */
export type LinePreview = { preview: string; hiddenLines: number };

export const previewLines = (text: string, limit: number = MAX_INLINE_DIFF_ROWS): LinePreview => {
  const lines = text.split("\n");
  if (lines.length <= limit) return { preview: text, hiddenLines: 0 };
  return { preview: lines.slice(0, limit).join("\n"), hiddenLines: lines.length - limit };
};

export type DisplayText = { text: string; truncated: boolean; notice: string };

/**
 * Cuts long tool output, so one row cannot stall the list. `keep` is the end of the text that
 * shows: the end of a command output holds its result and its newest lines.
 */
export const truncateForDisplay = (
  text: string,
  limit: number = MAX_DISPLAY_CHARACTERS,
  keep: "start" | "end" = "start",
): DisplayText =>
  text.length <= limit
    ? { text, truncated: false, notice: "" }
    : {
        text: keep === "start" ? text.slice(0, limit) : text.slice(-limit),
        truncated: true,
        notice: `Showing the ${keep === "start" ? "first" : "last"} ${limit.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")} characters. Copy the text to read all of it.`,
      };

// A row formats its time on each render, and the date format is slow on Hermes. Messages do not
// change, so each one formats once.
const timeLabels = new WeakMap<AgentChatMessage, string>();

/** The desktop message time with seconds, or "" when the history has no exact time. */
export const messageTimeLabel = (message: AgentChatMessage): string => {
  let label = timeLabels.get(message);
  if (label === undefined) {
    label = readMessageTimeLabel(message);
    timeLabels.set(message, label);
  }
  return label;
};
