import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { hasNonEmptyText } from "./tool-lifecycle";

const COMPUTER_USE_RESET_TOOL = "js_reset";
const SCRIPT_ERROR_PREFIX = /^Script error:\s*/;

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
  const withoutPrefix = errorText.trim().replace(SCRIPT_ERROR_PREFIX, "");
  const firstLine = withoutPrefix
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? "";
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
