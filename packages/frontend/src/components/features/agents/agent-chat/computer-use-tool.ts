import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { type CodexTruncatedResult, readCodexTruncatedResult } from "./codex-truncated-result";
import { hasNonEmptyText } from "./tool-lifecycle";

const COMPUTER_USE_RESET_TOOL = "js_reset";
const SCRIPT_ERROR_PREFIX = /^Script error:\s*/;
const FAILURE_SUMMARY_MAX_LENGTH = 200;
const TRUNCATED_FAILURE_SUMMARY = "Computer action failed. Codex truncated its diagnostics.";
const READABLE_LINE_PATTERN = /[\p{L}\p{N}]/u;

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

const recoveredTruncatedFailureLine = (truncated: CodexTruncatedResult): string | null => {
  if (truncated.kind !== "truncated" || truncated.head === null) {
    return null;
  }
  const line = firstFailureLine(truncated.head);
  return line !== null && READABLE_LINE_PATTERN.test(line) ? line : null;
};

export const computerUseLeafToolName = (tool: string): string => {
  const segments = tool.split(/[./]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? tool;
};

export const computerUseActionTitle = (meta: ToolMeta): string => {
  const rawTitle = meta.input?.title;
  if (hasNonEmptyText(rawTitle)) {
    return rawTitle.trim().replace(/\s+/g, " ");
  }
  return computerUseLeafToolName(meta.tool) === COMPUTER_USE_RESET_TOOL
    ? "Reset computer session"
    : "Computer action";
};

export const computerUseFailureSummary = (errorText: string | undefined): string => {
  if (!hasNonEmptyText(errorText)) {
    return "";
  }
  const text = errorText.trim();
  const truncated = readCodexTruncatedResult(text);
  if (truncated.kind === "truncated") {
    const recovered = recoveredTruncatedFailureLine(truncated);
    return recovered ? boundFailureLine(recovered) : TRUNCATED_FAILURE_SUMMARY;
  }
  const firstLine = firstFailureLine(text);
  return firstLine ? boundFailureLine(firstLine) : "";
};

export const computerUseCode = (meta: ToolMeta): string => {
  if (computerUseLeafToolName(meta.tool) === COMPUTER_USE_RESET_TOOL) {
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
