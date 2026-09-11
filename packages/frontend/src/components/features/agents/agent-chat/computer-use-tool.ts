import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { readCodexTruncatedResult } from "./codex-truncated-result";
import { hasNonEmptyText } from "./tool-lifecycle";

const RESET_TOOL = "js_reset";
const SCRIPT_ERROR_PREFIX = /^Script error:\s*/;
const FAILURE_SUMMARY_MAX_LENGTH = 200;
const TRUNCATED_FAILURE_SUMMARY = "Computer action failed. Codex truncated its diagnostics.";
const READABLE_LINE_PATTERN = /[\p{L}\p{N}]/u;

export const computerUseActionTitle = (meta: ToolMeta): string => {
  const rawTitle = meta.input?.title;
  if (hasNonEmptyText(rawTitle)) {
    return rawTitle.trim().replace(/\s+/g, " ");
  }
  return toolLeafName(meta.tool) === RESET_TOOL ? "Reset computer session" : "Computer action";
};

export const computerUseFailureSummary = (errorText: string | undefined): string => {
  if (!hasNonEmptyText(errorText)) {
    return "";
  }
  const text = errorText.trim();
  const truncated = readCodexTruncatedResult(text);
  if (truncated.kind === "truncated") {
    const line = truncated.head === null ? null : firstFailureLine(truncated.head);
    return line !== null && READABLE_LINE_PATTERN.test(line)
      ? boundFailureLine(line)
      : TRUNCATED_FAILURE_SUMMARY;
  }
  const firstLine = firstFailureLine(text);
  return firstLine ? boundFailureLine(firstLine) : "";
};

export const computerUseCode = (meta: ToolMeta): string => {
  if (toolLeafName(meta.tool) === RESET_TOOL) {
    return "";
  }
  const code = meta.input?.code;
  return hasNonEmptyText(code) ? code : "";
};

export const hasComputerUseDetails = (meta: ToolMeta): boolean => {
  return (
    computerUseCode(meta).length > 0 ||
    hasNonEmptyText(meta.output) ||
    hasNonEmptyText(meta.error) ||
    (meta.images?.length ?? 0) > 0
  );
};

const toolLeafName = (tool: string): string => {
  const segments = tool.split(/[./]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? tool;
};

const firstFailureLine = (text: string): string | null => {
  const firstLine = text
    .replace(SCRIPT_ERROR_PREFIX, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? null;
};

const boundFailureLine = (line: string): string =>
  line.length > FAILURE_SUMMARY_MAX_LENGTH
    ? `${line.slice(0, FAILURE_SUMMARY_MAX_LENGTH - 1)}…`
    : line;
