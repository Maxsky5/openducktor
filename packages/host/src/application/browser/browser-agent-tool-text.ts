import type {
  BrowserTabSummary,
  BrowserWaitCondition,
  OdtBrowserToolResult,
} from "@openducktor/contracts";
import type { BrowserAgentActionOutcome } from "./browser-agent-pages";
import type { BrowserConsoleEntry } from "./browser-console";

/** A tool result with one text part. */
export const textResult = (value: string): OdtBrowserToolResult => ({
  content: [{ type: "text", text: value }],
});

/** The result of an agent action: its own result, or the dialog or file chooser that it opened. */
export const actionResult = (
  tabId: string,
  outcome: BrowserAgentActionOutcome<OdtBrowserToolResult>,
): OdtBrowserToolResult => {
  if (outcome.kind === "done") {
    return outcome.value;
  }
  const { prompt } = outcome;
  if (prompt.kind === "file_chooser") {
    return textResult(
      `The action opened a file chooser in tab ${tabId}. Agents cannot upload files.`,
    );
  }
  const defaultText =
    prompt.type === "prompt" ? ` Default text: ${JSON.stringify(prompt.defaultPrompt)}.` : "";
  return textResult(
    `The action opened a JS ${prompt.type} dialog in tab ${tabId}: ${JSON.stringify(prompt.message)}.${defaultText} Answer it with odt_browser_dialog.`,
  );
};

/** One line of `odt_browser_list`. */
export const describeTab = (summary: BrowserTabSummary): string =>
  `${summary.tabId} [${summary.createdBy === "agent" ? "agent" : "shared"}] ${loadState(summary)} ${JSON.stringify(summary.title ?? "")} ${summary.url}`;

export const formatConsole = (entries: BrowserConsoleEntry[]): string =>
  entries
    .map((entry) => {
      const source = entry.source
        ? ` (${entry.source.url}:${entry.source.line}:${entry.source.column})`
        : "";
      const kind = entry.pageError ? "page error" : entry.level;
      return `#${entry.sequence} [${kind}] ${entry.text}${source}`;
    })
    .join("\n");

export const describeCondition = (condition: BrowserWaitCondition): string => {
  if ("text" in condition) return `text ${JSON.stringify(condition.text)} to show`;
  if ("ref" in condition) return `element ${condition.ref} to show`;
  if ("url" in condition) return `URL ${condition.url}`;
  return `the ${condition.load} state`;
};

const loadState = (summary: BrowserTabSummary): string => {
  if (!summary.started) return "saved, starts when you use it";
  if (!summary.live) return "not running";
  if (summary.error) return `error: ${summary.error.message}`;
  return summary.loading ? "loading" : "loaded";
};
