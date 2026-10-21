import { type AgentToolData, isOdtBrowserToolName } from "@openducktor/contracts";
import { z } from "zod";
import { readInputString } from "./tool-input-utils";
import { compactText } from "./tool-text-utils";

const BROWSER_TOOL_PREFIX = "odt_browser_";
/** Runtimes can put their MCP server prefix before the tool name, such as `mcp__openducktor__`. */
const BROWSER_TOOL_NAME_PATTERN = /(?:^|[._])(odt_browser_[a-z]+)$/u;
const SUMMARY_MAX_LENGTH = 160;

const browserConsoleLevelsSchema = z.array(z.string());

/** The action of an `odt_browser_*` tool call, such as `click`, or null for other tools. */
export const readBrowserToolAction = (toolName: string): string | null => {
  const canonicalName = BROWSER_TOOL_NAME_PATTERN.exec(toolName.trim())?.[1];
  if (canonicalName === undefined || !isOdtBrowserToolName(canonicalName)) {
    return null;
  }
  return canonicalName.slice(BROWSER_TOOL_PREFIX.length);
};

/** The condition of a wait. A wait with no condition waits for the `load` state. */
const summarizeWaitCondition = (input: AgentToolData | undefined): string => {
  const text = readInputString(input, ["text"]);
  if (text !== null) {
    return `"${text}"`;
  }
  return readInputString(input, ["ref", "url", "load"]) ?? "load";
};

const summarizeDialogAnswer = (accept: AgentToolData[string] | undefined): string => {
  if (accept === true) {
    return "accept";
  }
  if (accept === false) {
    return "dismiss";
  }
  return "";
};

const summarizeConsoleLevels = (levels: AgentToolData[string] | undefined): string => {
  const parsed = browserConsoleLevelsSchema.safeParse(levels);
  return parsed.success ? parsed.data.join(", ") : "";
};

/**
 * A short target for a browser action row, such as `e12` for `Browser click e12`.
 * Typed text stays out of the summary because it can hold secrets.
 */
export const summarizeBrowserToolInput = (
  action: string,
  input: AgentToolData | undefined,
): string => {
  switch (action) {
    case "open":
      return compactText(readInputString(input, ["url"]) ?? "", SUMMARY_MAX_LENGTH);
    case "navigate":
      return compactText(readInputString(input, ["url", "action"]) ?? "", SUMMARY_MAX_LENGTH);
    case "click":
    case "hover":
    case "type":
    case "select":
      return readInputString(input, ["ref"]) ?? "";
    case "scroll":
    case "screenshot":
      return readInputString(input, ["ref"]) ?? "page";
    case "press":
      return readInputString(input, ["key"]) ?? "";
    case "wait":
      return compactText(summarizeWaitCondition(input), SUMMARY_MAX_LENGTH);
    case "dialog":
      return summarizeDialogAnswer(input?.accept);
    case "console":
      return summarizeConsoleLevels(input?.levels);
    default:
      return "";
  }
};
