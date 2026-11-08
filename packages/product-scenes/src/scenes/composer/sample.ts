// The sample data of the composer scene: a Builder session of the PDF export task on Claude Code.
// The slash menu merges the catalog of Claude Code with the reusable prompts of the workspace, as
// use-chat-composer-slash-commands.ts does. The skills, the prompts, and the files are fictional.
import type { FileKind } from "../../replicas/transcript/ReferenceChip";
import { COMMANDS } from "../../sample/commands";
import type { Session } from "../../sample/sessions";

export const COMPOSER_SESSION = {
  runtime: "claude",
  model: "claude-lyra-3",
  effort: "high",
  window: 200_000,
  used: 31.4,
  speed: "standard",
} satisfies Session;

/** The source of a slash command, which the menu shows as a badge. */
type Source = "system" | "command" | "skill" | "custom";

export type SlashCommand = {
  trigger: string;
  source: Source;
  description: string;
  /** The argument hints that the menu shows after the source. */
  hint?: string;
};

/** A skill of the repository. Claude Code gives a skill no other title, so its label is its name. */
export type Skill = { name: string; description: string };

/** The skills of the repository, in name order. */
export const SKILLS: readonly Skill[] = [
  { name: "markdown-style", description: "Format notebook Markdown in the style of the project." },
  {
    name: "print-layout",
    description: "Check page margins, page breaks, and headers of printed notebooks.",
  },
  { name: "release-notes", description: "Write release notes from the merged pull requests." },
  { name: "test-fixtures", description: "Make sample notebooks for the tests." },
];

/** The skill that the visitor adds. */
export const SKILL = "print-layout";

/** The fixed commands of Claude Code that the menu shows, with their descriptions. */
const RUNTIME_COMMANDS: readonly SlashCommand[] = [
  {
    trigger: "context",
    source: "command",
    description: "Visualize current context usage as a colored grid",
  },
  {
    trigger: "init",
    source: "command",
    description: "Initialize a new CLAUDE.md file with codebase documentation",
  },
  { trigger: "review", source: "command", description: "Review a pull request" },
  {
    trigger: "security-review",
    source: "command",
    description: "Complete a security review of the pending changes on the current branch",
  },
];

/** The reusable prompts of the workspace: those of the chat scene, and one review prompt. */
const REUSABLE_PROMPTS: readonly SlashCommand[] = [
  ...COMMANDS.map((command) => ({ ...command, source: "custom" as const })),
  {
    trigger: "review-notes",
    source: "custom",
    description: "Check the open changes against the notes style guide.",
  },
];

/**
 * The /compact command of OpenDucktor: MANUAL_SESSION_COMPACTION_SLASH_COMMAND of
 * slash-command-schemas.ts.
 */
export const COMPACT_COMMAND: SlashCommand = {
  trigger: "compact",
  source: "system",
  description: "Summarize the current session to reduce context size",
};

/**
 * The /goal command of OpenDucktor: GOAL_SLASH_COMMAND of slash-command-schemas.ts. A session on
 * a runtime with native goals lists it after /compact.
 */
export const GOAL_COMMAND: SlashCommand = {
  trigger: "goal",
  source: "system",
  description: "Keep working until the objective is met",
  hint: "<objective> | pause | resume | clear",
};

/**
 * The slash menu of the session, as mergeSlashCommands of use-chat-composer-slash-commands.ts
 * orders it: /compact and /goal first, then the Claude Code commands and skills in trigger order,
 * then the reusable prompts.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  COMPACT_COMMAND,
  GOAL_COMMAND,
  ...[
    ...RUNTIME_COMMANDS,
    ...SKILLS.map((skill) => ({
      trigger: skill.name,
      source: "skill" as const,
      description: skill.description,
    })),
  ].toSorted((left, right) => left.trigger.localeCompare(right.trigger)),
  ...REUSABLE_PROMPTS,
];

/** The slash query that the visitor types, and the command that it picks. */
export const SLASH_QUERY = "/rev";
export const COMMAND = "review";

/** A file search result, with the kind that sets its icon. */
export type FileResult = { name: string; path: string; kind: FileKind };

/** The file that the visitor picks: the first result. */
export const FILE: FileResult = { name: "pdf.ts", path: "src/export/pdf.ts", kind: "code" };

/** The file query that the visitor types, and the results of the search, in their order. */
export const FILE_QUERY = "@pdf";
export const FILES: readonly FileResult[] = [
  FILE,
  { name: "pdf.test.ts", path: "src/export/pdf.test.ts", kind: "code" },
  { name: "pdf-export.md", path: "docs/pdf-export.md", kind: "default" },
];

/** The text of the message around its references. */
export const MESSAGE = { afterCommand: "the page breaks in ", afterFile: "with " };
