import type { AgentToolData } from "@openducktor/contracts";
import {
  basenameForPath,
  isAbsolutePath,
  normalizePathSeparators,
  toDisplayRelativePath,
  trimTrailingPathSeparators,
} from "@openducktor/path-support";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { readInputString } from "./tool-input-utils";
import { getToolLifecyclePhase, hasNonEmptyText, type ToolLifecyclePhase } from "./tool-lifecycle";

/** Codex runs its reads, lists, and searches as shell commands, and gives the command it ran. */
const SHELL_ACTION_TOOL_TYPES: ReadonlySet<ToolMeta["toolType"]> = new Set([
  "read",
  "list",
  "search",
]);

/**
 * A call that runs a shell command: a bash call, or a read, list, or search call that gives the
 * command it ran. A bash call is a shell command also while the runtime prepares its input.
 */
export const isShellCommandCall = (meta: ToolMeta): boolean =>
  meta.toolType === "bash" ||
  (SHELL_ACTION_TOOL_TYPES.has(meta.toolType) && hasNonEmptyText(meta.input?.command));

/** The parts of a shell command call that the transcript and the tool details show. */
export type ShellCommandCall = {
  /** Empty while the runtime prepares the input. Copy actions use this full command. */
  command: string;
  /**
   * The command without a first `cd <directory> &&` step. Agents often start each command with
   * one, and it hides the part that differs from the other commands.
   */
  shownCommand: string;
  /** The directory of that first `cd` step, or null when the command has none. */
  commandDirectory: string | null;
  /** The reason that the agent gave for the command. */
  description: string | null;
  workingDirectory: string | null;
  timeoutMs: number | null;
  exitCode: number | null;
};

const isFiniteNumber = (value: AgentToolData[string] | undefined): value is number =>
  Number.isFinite(value);

const readNumber = (data: AgentToolData | undefined, key: string): number | null => {
  const value = data?.[key];
  return isFiniteNumber(value) ? value : null;
};

// `cd dir &&`, `cd "dir with spaces";`, or `cd 'dir' &&` at the start of a command.
const LEADING_CD = /^\s*cd\s+(?:"([^"\n]+)"|'([^'\n]+)'|([^\s;&|'"]+))\s*(?:&&|;)\s*/;

/** A command without its first `cd <directory> &&` step, and that directory. */
export type LeadingDirectoryChange = Pick<ShellCommandCall, "shownCommand" | "commandDirectory">;

/** Splits a first `cd <directory> &&` step from a command. The rest must not be empty. */
export const splitLeadingDirectoryChange = (command: string): LeadingDirectoryChange => {
  const match = LEADING_CD.exec(command);
  const rest = match ? command.slice(match[0].length) : "";
  if (!match || rest.trim().length === 0) return { shownCommand: command, commandDirectory: null };
  return { shownCommand: rest, commandDirectory: match[1] ?? match[2] ?? match[3] ?? null };
};

export const readShellCommandCall = (meta: ToolMeta): ShellCommandCall => {
  const command = readInputString(meta.input, ["command"]) ?? "";
  return {
    command,
    ...splitLeadingDirectoryChange(command),
    description: readInputString(meta.input, ["description"]),
    workingDirectory: readInputString(meta.input, ["workdir", "cwd"]),
    timeoutMs: readNumber(meta.input, "timeout"),
    exitCode: readNumber(meta.metadata, "exit"),
  };
};

// A shell keyword starts a script, not a program, so the command has no short name.
const SHELL_KEYWORDS = new Set(["for", "while", "until", "if", "case", "{", "(", "function"]);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// A subcommand is a plain word, such as `status` or `check`, not a flag, a file, or a value.
const SUBCOMMAND = /^[a-z][a-z0-9:_-]*$/;
const RUNNER_SUBCOMMANDS = new Set(["run", "exec", "x", "dlx"]);
// Programs that run the command after them, with the words that they take first. `rtk` filters the
// output of the command after it, and `rtk proxy` runs a command without a filter.
const WRAPPER_PROGRAMS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["sudo", new Set<string>()],
  ["time", new Set<string>()],
  ["nohup", new Set<string>()],
  ["command", new Set<string>()],
  ["exec", new Set<string>()],
  ["rtk", new Set(["proxy"])],
]);

/** The place of the program in the words of a command, after its variables and wrappers. */
const findProgramWord = (words: readonly string[]): number => {
  let index = 0;
  for (;;) {
    while (index < words.length && ENV_ASSIGNMENT.test(words[index] ?? "")) index += 1;
    const wrapperWords = WRAPPER_PROGRAMS.get(words[index] ?? "");
    if (!wrapperWords || index + 1 >= words.length) return index;
    index += 1;
    if (wrapperWords.has(words[index] ?? "") && index + 1 < words.length) index += 1;
  }
};

/** The program of a command without its folder, such as `tsc` for `./node_modules/.bin/tsc`. */
const programName = (word: string): string => {
  const program = word.replace(/^["']|["']$/g, "");
  return basenameForPath(program) || program;
};

/**
 * The short name of a command: its program without the folder, and its subcommand, such as
 * `git status` or `biome check`. A wrapper program, such as `sudo`, gives the command that it runs.
 * Null for a script that starts with a shell keyword.
 */
export const readShellCommandTitle = (command: string): string | null => {
  const words = command.trim().split(/\s+/);
  const index = findProgramWord(words);
  const word = words[index];
  if (!word || SHELL_KEYWORDS.has(word)) return null;
  const name = programName(word);
  const next = words[index + 1];
  if (!next || !SUBCOMMAND.test(next)) return name;
  // A runner subcommand, as in `bun run build`, takes the name of the script that it runs.
  const script = RUNNER_SUBCOMMANDS.has(next) ? words[index + 2] : undefined;
  return script && SUBCOMMAND.test(script) ? `${name} ${next} ${script}` : `${name} ${next}`;
};

/** A part of a command line with the folder of its program removed. */
const withoutProgramFolder = (piece: string): string => {
  const words = [...piece.matchAll(/\S+/g)];
  const word = words[findProgramWord(words.map(([text]) => text))];
  if (!word) return piece;
  const end = word.index + word[0].length;
  return `${piece.slice(0, word.index)}${programName(word[0])}${piece.slice(end)}`;
};

// The operators that join the commands of a line, longest first.
const COMMAND_OPERATORS = ["&&", "||", "|", ";"];

/**
 * A command line with the folder of the program of each of its commands removed, such as
 * `tsc && git diff` for `./node_modules/.bin/tsc && git diff`. Operators inside quotes do not
 * split the line.
 */
const withoutProgramFolders = (line: string): string => {
  let shown = "";
  let start = 0;
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === "\\" && quote !== "'") {
      index += 1;
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else {
      const operator = COMMAND_OPERATORS.find((candidate) => line.startsWith(candidate, index));
      if (operator) {
        shown += `${withoutProgramFolder(line.slice(start, index))}${operator}`;
        start = index + operator.length;
        index = start - 1;
      }
    }
  }
  return `${shown}${withoutProgramFolder(line.slice(start))}`;
};

/**
 * The line of a command in a row: its first line without the folder of each program, such as
 * `./node_modules/.bin/`, and the count of its other lines. The details give the whole command.
 */
export type ShellCommandRowText = { text: string; extraLineCount: number };

export const readShellCommandRowText = (command: string): ShellCommandRowText => {
  const { firstLine, extraLineCount } = readShellCommandLine(command);
  return { text: withoutProgramFolders(firstLine), extraLineCount };
};

/** The name of a command in its details, such as `git status`. */
export const readShellCommandName = (command: string): string =>
  readShellCommandTitle(command) ?? "Shell command";

/**
 * The folder of a command as the details show it: nothing for the folder of the session, a path
 * relative to it for a folder inside it, and the last three folders of any other path.
 */
export const readCommandFolderLabel = (
  call: Pick<ShellCommandCall, "commandDirectory" | "workingDirectory">,
  sessionFolder: string | null,
): string | null => {
  const folder = call.commandDirectory ?? call.workingDirectory;
  if (!folder) return null;
  const shown = toDisplayRelativePath(folder, sessionFolder);
  if (shown === ".") return null;
  const path = trimTrailingPathSeparators(shown);
  if (!isAbsolutePath(path)) return path;
  const parts = normalizePathSeparators(path)
    .split("/")
    .filter((part) => part.length > 0);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
};

/** The output of a shell command call, as its details show it. */
export type ShellCommandOutput = {
  /** The output, or the error of a failed command that gave no output. */
  text: string;
  /** The error of a failed command that also gave output. It shows first, as stderr. */
  error: string;
  /** The text is the error of a failed command that gave no output. */
  isError: boolean;
  /** The message for the agent of a call that did not run. It shows in place of the output. */
  message: string;
};

export const readShellCommandOutput = (meta: ToolMeta): ShellCommandOutput => {
  const phase = getToolLifecyclePhase(meta);
  const output = hasNonEmptyText(meta.output) ? meta.output : "";
  // Some runtimes give the output of a failed command as its error. Show that text once.
  const error = hasNonEmptyText(meta.error) && meta.error !== meta.output ? meta.error : "";
  // A call that did not run has a message for the agent, not output.
  if (phase === "cancelled" && !output && error) {
    return { text: "", error: "", isError: false, message: error };
  }
  return {
    text: output || error,
    error: output ? error : "",
    isError: !output && phase === "failed",
    message: "",
  };
};

/** What the details of a command say when it has no output yet, by its status. */
export const EMPTY_SHELL_OUTPUT = {
  preparing: "The agent is writing the command.",
  queued: "The command has not started.",
  executing: "The command is running. No output yet.",
  completed: "The command finished without output.",
  failed: "The command failed without output.",
  cancelled: "The command stopped before it gave output.",
} as const satisfies Record<ToolLifecyclePhase, string>;

/**
 * What the details of a command say when it has no output yet. A runtime that sends no running
 * output gives the output of a command only when the command ends.
 */
export const readEmptyShellOutput = (
  phase: ToolLifecyclePhase,
  showsRunningOutput: boolean,
): string =>
  phase === "executing" && !showsRunningOutput
    ? "The command is running. Its output shows when it ends."
    : EMPTY_SHELL_OUTPUT[phase];

/** The first line of a command, and the count of its other lines. */
export type ShellCommandLine = { firstLine: string; extraLineCount: number };

export const readShellCommandLine = (command: string): ShellCommandLine => {
  const end = command.indexOf("\n");
  return end < 0
    ? { firstLine: command, extraLineCount: 0 }
    : { firstLine: command.slice(0, end), extraLineCount: countTextLines(command) - 1 };
};

/** The count of lines of a text. A last line break does not start a line. */
export const countTextLines = (text: string): number => {
  if (text.length === 0) return 0;
  let count = 1;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    count += 1;
  }
  return text.endsWith("\n") ? count - 1 : count;
};
