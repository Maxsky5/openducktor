import {
  ODT_TOOL_NAMES,
  type OdtToolName,
  type PullRequest,
  pullRequestSchema,
  toClaudeOdtToolAliases,
  toOpencodeOdtToolAliases,
} from "@openducktor/contracts";
import { z } from "zod";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { readInputString } from "./tool-input-utils";
import { getToolLifecyclePhase } from "./tool-lifecycle";
import { parseToolOutput } from "./tool-output-utils";

/** Each name that a runtime gives an ODT tool, in lower case, with its canonical name. */
const ODT_TOOL_BY_ALIAS: ReadonlyMap<string, OdtToolName> = new Map(
  ODT_TOOL_NAMES.flatMap((name) =>
    [name, ...toOpencodeOdtToolAliases(name), ...toClaudeOdtToolAliases(name)].map(
      (alias) => [alias, name] as const,
    ),
  ),
);

/** The ODT tool of a call under its canonical name, or null for another tool. */
export const readOdtToolName = (tool: string): OdtToolName | null =>
  ODT_TOOL_BY_ALIAS.get(tool.trim().toLowerCase()) ?? null;

/** The icon of an ODT tool card. Each client draws it with its own icon set. */
export type OdtToolIconKind = "workflow" | "git-pull-request";

/** What the card of an ODT tool reads from its call. */
export type OdtToolCardContent = {
  /**
   * The event of an `odt_apply_workflow_event` call in title case words, such as "Build
   * Completed" for `build-completed`. Null for another tool or before the input has an event.
   */
  title: string | null;
  /** The Markdown note of an `odt_apply_workflow_event` call, from its input. */
  note: string | null;
  /** The pull request that a completed `odt_set_pull_request` call saved, from its output. */
  pullRequest: PullRequest | null;
};

/** An ODT tool with a card of its own: its name, its icon, and what its card reads. */
export type OdtToolCard = {
  displayName: string;
  iconKind: OdtToolIconKind;
  read: (meta: ToolMeta) => OdtToolCardContent;
};

const setPullRequestOutputSchema = z.object({ pullRequest: pullRequestSchema });

/**
 * The ODT tools with a card of their own. The card header shows the event or the pull request of
 * the call, so these calls have no summary line.
 */
export const ODT_TOOL_CARDS: ReadonlyMap<OdtToolName, OdtToolCard> = new Map([
  [
    "odt_apply_workflow_event",
    {
      displayName: "Workflow Event",
      iconKind: "workflow",
      read: (meta) => ({
        title: toTitleWords(readInputString(meta.input, ["eventId"])),
        note: readInputString(meta.input, ["note"]),
        pullRequest: null,
      }),
    },
  ],
  [
    "odt_set_pull_request",
    {
      displayName: "Set Pull Request",
      iconKind: "git-pull-request",
      read: (meta) => ({
        title: null,
        note: null,
        pullRequest:
          getToolLifecyclePhase(meta) === "completed"
            ? (parseToolOutput(setPullRequestOutputSchema, meta.output)?.pullRequest ?? null)
            : null,
      }),
    },
  ],
]);

const toTitleWords = (id: string | null): string | null => {
  if (!id) return null;
  return id
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};
