import { type AgentToolData, isOdtBrowserToolName, type OdtToolName } from "@openducktor/contracts";
import { z } from "zod";
import { localImagePathOf } from "@/lib/local-image-path";
import { readInputString } from "./tool-input-utils";
import { compactText } from "./tool-text-utils";

const BROWSER_TOOL_PREFIX = "odt_browser_";
const TITLE_TEXT_MAX_LENGTH = 160;

const stringListSchema = z.array(z.string());

/** The action of an `odt_browser_*` tool, such as `click`, or null for other tools. */
export const readBrowserToolAction = (odtTool: OdtToolName): string | null =>
  isOdtBrowserToolName(odtTool) ? odtTool.slice(BROWSER_TOOL_PREFIX.length) : null;

const quote = (text: string): string => `"${compactText(text, TITLE_TEXT_MAX_LENGTH)}"`;

const readStringList = (value: AgentToolData[string] | undefined): string[] => {
  const parsed = stringListSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
};

const navigateTitle = (action: string | null): string => {
  switch (action) {
    case "back":
      return "Go back";
    case "forward":
      return "Go forward";
    case "reload":
      return "Reload";
    default:
      return "Navigate";
  }
};

const clickVerb = (input: AgentToolData | undefined): string => {
  if (input?.doubleClick === true) return "Double-click";
  const button = readInputString(input, ["button"]);
  if (button === "right") return "Right-click";
  if (button === "middle") return "Middle-click";
  return "Click";
};

const scrollDeltasSchema = z.object({
  deltaX: z.number().default(0),
  deltaY: z.number().default(0),
});

const scrollDirection = (input: AgentToolData | undefined): string => {
  const parsed = scrollDeltasSchema.safeParse(input ?? {});
  const { deltaX, deltaY } = parsed.success ? parsed.data : { deltaX: 0, deltaY: 0 };
  if (deltaY !== 0) return `${deltaY > 0 ? "down" : "up"} ${Math.abs(deltaY)} px`;
  if (deltaX !== 0) return `${deltaX > 0 ? "right" : "left"} ${Math.abs(deltaX)} px`;
  return "page";
};

/** The condition of a wait. A wait with no condition waits for the `load` state. */
const waitCondition = (input: AgentToolData | undefined): string => {
  const text = readInputString(input, ["text"]);
  if (text !== null) return quote(text);
  return readInputString(input, ["ref", "url", "load"]) ?? "load";
};

const dialogTitle = (input: AgentToolData | undefined): string => {
  if (input?.accept === false) return "Dismiss dialog";
  const promptText = readInputString(input, ["promptText"]);
  return promptText === null ? "Accept dialog" : `Accept dialog with ${quote(promptText)}`;
};

/** The title of a browser action, such as `Type "hello" and press Enter`. */
export const browserToolTitle = (action: string, input: AgentToolData | undefined): string => {
  const ref = readInputString(input, ["ref"]) ?? "";
  switch (action) {
    case "list":
      return "List tabs";
    case "open":
      return `Open ${compactText(readInputString(input, ["url"]) ?? "", TITLE_TEXT_MAX_LENGTH)}`;
    case "navigate": {
      const url = readInputString(input, ["url"]);
      if (url !== null) return `Go to ${compactText(url, TITLE_TEXT_MAX_LENGTH)}`;
      return navigateTitle(readInputString(input, ["action"]));
    }
    case "close":
      return "Close tab";
    case "snapshot":
      return "Snapshot";
    case "click":
      return `${clickVerb(input)} ${ref}`;
    case "hover":
      return `Hover ${ref}`;
    case "type": {
      const submit = input?.submit === true ? " and press Enter" : "";
      return `Type ${quote(readInputString(input, ["text"]) ?? "")}${submit}`;
    }
    case "press":
      return `Press ${readInputString(input, ["key"]) ?? ""}`;
    case "select":
      return `Select ${readStringList(input?.values).map(quote).join(", ")}`;
    case "scroll":
      return ref ? `Scroll to ${ref}` : `Scroll ${scrollDirection(input)}`;
    case "screenshot":
      return `Screenshot ${ref || "page"}`;
    case "console": {
      const levels = readStringList(input?.levels);
      return levels.length > 0 ? `Console ${levels.join(", ")}` : "Console";
    }
    case "wait":
      return `Wait for ${waitCondition(input)}`;
    case "dialog":
      return dialogTitle(input);
    default:
      return action;
  }
};

/** The host saves each agent screenshot and names it in the result as `Saved to file:///….png.` */
const SAVED_SCREENSHOT = /Saved to (file:\/\/\S+?\.png)\./g;

/**
 * The saved screenshot files of a browser tool result. Codex can put the whole result into one
 * text, so the files come from the text in every runtime.
 */
export const browserToolScreenshotPaths = (output: string | undefined): string[] =>
  Array.from((output ?? "").matchAll(SAVED_SCREENSHOT)).flatMap((match) => {
    const path = localImagePathOf(match[1] ?? "");
    return path === null ? [] : [path];
  });
