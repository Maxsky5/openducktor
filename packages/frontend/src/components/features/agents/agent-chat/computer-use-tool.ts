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
  return isResetTool(meta.tool) ? "Reset computer session" : "Computer action";
};

export const computerUseFailureSummary = (errorText: string | undefined): string => {
  if (!hasNonEmptyText(errorText)) {
    return "";
  }
  const text = errorText.trim();
  const truncated = readCodexTruncatedResult(text);
  if (truncated.kind === "not_truncated") {
    return boundFailureLine(firstFailureLine(text));
  }
  const line = firstFailureLine(truncated.head ?? "");
  if (line.length === 0 || !READABLE_LINE_PATTERN.test(line)) {
    return TRUNCATED_FAILURE_SUMMARY;
  }
  return boundFailureLine(line);
};

export const computerUseCode = (meta: ToolMeta): string => {
  if (isResetTool(meta.tool)) {
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

const isResetTool = (tool: string): boolean => toolLeafName(tool) === RESET_TOOL;

const toolLeafName = (tool: string): string => {
  const segments = tool.split(/[./]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? tool;
};

const firstFailureLine = (text: string): string => {
  const firstLine = text
    .replace(SCRIPT_ERROR_PREFIX, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? "";
};

const boundFailureLine = (line: string): string =>
  line.length > FAILURE_SUMMARY_MAX_LENGTH
    ? `${line.slice(0, FAILURE_SUMMARY_MAX_LENGTH - 1)}…`
    : line;
