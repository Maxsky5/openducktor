import { ODT_TASK_READ_TOOL_NAMES, type OdtToolName } from "@openducktor/contracts";
import type { ToolMeta } from "../messages/agent-chat-message-card-model.types";
import { buildTaskToolSummary } from "../messages/agent-chat-task-tool-model";
import { plural } from "../../lib/plural";
import {
  readToolCallFilePath,
  readToolCallName,
  readToolErrorPreview,
  readToolFileEdits,
  resolveRegularToolSummary,
} from "../messages/agent-chat-tool-presentation";
import { readOdtToolName } from "../messages/odt-tool-call";
import {
  isShellCommandCall,
  readShellCommandCall,
  readShellCommandName,
  readShellCommandRowText,
} from "../messages/shell-command-call";
import {
  getToolLifecyclePhase,
  isToolMessageActive,
  type ToolLifecyclePhase,
} from "../messages/tool-lifecycle";
import type { AgentChatRuntimePresentation } from "../send/agent-chat.types";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";
import type { AgentChatMessage } from "../../types/agent-orchestrator";

/** The kinds of calls in a tool run, in the order that a run header counts them. */
export const TOOL_RUN_CALL_KINDS = [
  "command",
  "read",
  "list",
  "search",
  "edit",
  "web",
  "tool",
] as const;
export type ToolRunCallKind = (typeof TOOL_RUN_CALL_KINDS)[number];

/** The kind of a call that a tool run holds, or null for a call with its own display. */
export type ToolRunClassifier = (meta: ToolMeta) => ToolRunCallKind | null;

type PresentToolCall = AgentChatRuntimePresentation["presentToolCall"];

// The tools that read, list, or search files, by the names that the runtimes give them. A tool of
// a server, such as an MCP search, is a tool call of the run.
const FILE_LOOKUP_TOOLS = new Set(["read", "view", "list", "ls", "glob", "grep", "find", "search"]);

// The ODT tools that read tasks and artifacts. They change nothing, so they show one line, as the
// other tool calls. The other ODT tools change the task or act in a browser, and have their cards.
const ODT_RUN_TOOLS: ReadonlySet<OdtToolName> = new Set(ODT_TASK_READ_TOOL_NAMES);

// Calls that show more than their line: questions show their answers, and computer use its
// screens. A todo update marks the progress of the plan, so it stays between the runs that it
// divides.
const ALONE_TOOL_TYPES: ReadonlySet<ToolMeta["toolType"]> = new Set([
  "question",
  "todo",
  "computer_use",
  "workflow",
]);

const readCallKind = (meta: ToolMeta, presentToolCall: PresentToolCall): ToolRunCallKind | null => {
  if (isShellCommandCall(meta)) return "command";
  const { toolType } = meta;
  if (
    (toolType === "read" || toolType === "list" || toolType === "search") &&
    FILE_LOOKUP_TOOLS.has(meta.tool.trim().toLowerCase())
  ) {
    return toolType;
  }
  if (toolType === "web") return "web";
  if (toolType === "file_edit") return "edit";
  const odtTool = readOdtToolName(meta.tool);
  if (odtTool !== null) return ODT_RUN_TOOLS.has(odtTool) ? "tool" : null;
  if (ALONE_TOOL_TYPES.has(toolType)) return null;
  // Workflow tools of a runtime have their own cards.
  return presentToolCall(meta.tool, meta.displayLabel).kind === "regular" ? "tool" : null;
};

/** A classifier for transcripts that show each call as its own row. */
export const NO_TOOL_RUNS: ToolRunClassifier = () => null;

// One classifier for each presentation, so the classifiers keep their identity from one render to
// the next. A message keeps its meta object while it does not change, so each call is read once.
const classifiers = new WeakMap<PresentToolCall, ToolRunClassifier>();

/**
 * The classifier of the tool runs of a runtime. A run holds the shell commands of an agent, its
 * file reads, lists, searches, and edits, its web searches, the ODT tools that read tasks, and the
 * calls of other tools that show one line, such as MCP tools. Codex runs its file lookups as shell commands,
 * and the other runtimes call a tool for each.
 */
export const readToolRunClassifier = (presentToolCall: PresentToolCall): ToolRunClassifier => {
  const known = classifiers.get(presentToolCall);
  if (known) return known;
  const kinds = new WeakMap<ToolMeta, ToolRunCallKind | null>();
  const classify: ToolRunClassifier = (meta) => {
    const knownKind = kinds.get(meta);
    if (knownKind !== undefined) return knownKind;
    const kind = readCallKind(meta, presentToolCall);
    kinds.set(meta, kind);
    return kind;
  };
  classifiers.set(presentToolCall, classify);
  return classify;
};

/** A transcript row of a call that a tool run holds. */
export type ToolRunRow = Extract<AgentChatTranscriptRow, { kind: "message" }> & {
  message: AgentChatMessage & { meta: ToolMeta };
};

export const isToolRunRow = (
  row: AgentChatTranscriptRow,
  classify: ToolRunClassifier,
): row is ToolRunRow =>
  row.kind === "message" &&
  row.message.meta?.kind === "tool" &&
  classify(row.message.meta) !== null;

/** The line of a call in a run, as its own tool row would show it. */
export type ToolRunCallLine = {
  /** The common name of the tool, such as `bash`, `edit`, or `read`. */
  name: string;
  /** The name of the tool that the agent called, such as `apply_patch`. The details show it. */
  toolName: string;
  /** A call that did not run, or that stopped, shows dim. */
  isMuted: boolean;
  /** The first line of the error of a failed call, or null. */
  errorPreview: string | null;
} & (
  | {
      kind: "command";
      /** The first line of the command, or a note while the agent writes the command. */
      text: string;
      /** The agent still writes the command, so `text` is a note and not code. */
      isPreparing: boolean;
      extraLineCount: number;
      /** The name of the command in its details, such as `git status`. */
      title: string;
    }
  | {
      kind: "call";
      /** The path of a file lookup or an edit, a task search, or the input of a tool call. */
      summary: string;
      /** The summary is a path or a pattern, which shows in the font of code. */
      isPath: boolean;
      /** The file that a read or a one-file edit acts on. Its type icon shows before the summary. */
      filePath: string | null;
      /** The lines that an edit added and removed, or null for a call that changes no file. */
      changes: { additions: number; deletions: number } | null;
    }
);

const MUTED_PHASES: ReadonlySet<ToolLifecyclePhase> = new Set(["preparing", "queued", "cancelled"]);

const FILE_LOOKUP_KINDS: ReadonlySet<ToolRunCallKind | null> = new Set(["read", "list", "search"]);

const readEditLine = (meta: ToolMeta, workingDirectory: string | null) => {
  const { edits } = readToolFileEdits(meta, workingDirectory);
  const [first] = edits;
  const changes = edits.reduce(
    (total, edit) => ({
      additions: total.additions + edit.additions,
      deletions: total.deletions + edit.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  if (edits.length > 1) {
    return { summary: `${edits.length} files`, isPath: false, filePath: null, changes };
  }
  const filePath = first?.filePath ?? null;
  return { summary: filePath ?? "", isPath: filePath !== null, filePath, changes };
};

/**
 * The line of a call as its own tool row would show it. A shell command shows its first line, a
 * task search its filters, and a file lookup or an edit its path.
 */
export const readToolRunCallLine = (
  row: ToolRunRow,
  presentToolCall: PresentToolCall,
  workingDirectory: string | null,
): ToolRunCallLine => {
  const { meta, content } = row.message;
  const presentation = presentToolCall(meta.tool, meta.displayLabel);
  const toolName = presentation.displayName;
  const name = readToolCallName(meta, toolName);
  const isMuted = MUTED_PHASES.has(getToolLifecyclePhase(meta));
  if (isShellCommandCall(meta)) {
    const { shownCommand } = readShellCommandCall(meta);
    const { text, extraLineCount } = readShellCommandRowText(shownCommand);
    return {
      kind: "command",
      name,
      toolName,
      isMuted,
      errorPreview: readToolErrorPreview(meta),
      text: text || "Preparing the command",
      isPreparing: !text,
      extraLineCount,
      title: readShellCommandName(shownCommand),
    };
  }
  if (meta.toolType === "file_edit") {
    return {
      kind: "call",
      name,
      toolName,
      isMuted,
      errorPreview: readToolErrorPreview(meta),
      ...readEditLine(meta, workingDirectory),
    };
  }
  const filePath = readToolCallFilePath(meta, workingDirectory);
  const call = { kind: "call", name, toolName, isMuted, filePath, changes: null } as const;
  const isPath =
    filePath !== null || FILE_LOOKUP_KINDS.has(readToolRunClassifier(presentToolCall)(meta));
  if (presentation.kind === "task") {
    const summary = buildTaskToolSummary(presentation.taskTool, meta, null);
    return { ...call, summary, isPath, errorPreview: readToolErrorPreview(meta) };
  }
  const { text, errorPreview } = resolveRegularToolSummary(meta, content, workingDirectory);
  return { ...call, summary: text, isPath, errorPreview };
};

/** The counts that the header of a tool run shows. */
export type ToolRunSummary = {
  callCount: number;
  /** The calls of each kind. */
  kindCounts: Readonly<Record<ToolRunCallKind, number>>;
  /** The files that the edit calls change. A patch can change several files in one call. */
  fileEditCount: number;
  failedCount: number;
  /** The calls that stopped, or that never ran because the user or a policy declined them. */
  cancelledCount: number;
  activeCount: number;
};

// A tool meta does not change after it is built, and a patch can be long, so each edit call reads
// its files once.
const editedFileCounts = new WeakMap<ToolMeta, number>();

const countEditedFiles = (meta: ToolMeta): number => {
  const known = editedFileCounts.get(meta);
  if (known !== undefined) return known;
  // An edit whose input does not name its files yet still counts as one edit.
  const count = Math.max(1, readToolFileEdits(meta).edits.length);
  editedFileCounts.set(meta, count);
  return count;
};

export const summarizeToolRun = (
  run: readonly ToolRunRow[],
  classify: ToolRunClassifier,
): ToolRunSummary => {
  const kindCounts = { command: 0, read: 0, list: 0, search: 0, edit: 0, web: 0, tool: 0 };
  let fileEditCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let activeCount = 0;
  for (const row of run) {
    const kind = classify(row.message.meta);
    if (kind) kindCounts[kind] += 1;
    if (kind === "edit") fileEditCount += countEditedFiles(row.message.meta);
    const phase = getToolLifecyclePhase(row.message.meta);
    if (phase === "failed") failedCount += 1;
    if (phase === "cancelled") cancelledCount += 1;
    if (isToolMessageActive(row.message.meta)) activeCount += 1;
  }
  return {
    callCount: run.length,
    kindCounts,
    fileEditCount,
    failedCount,
    cancelledCount,
    activeCount,
  };
};

const KIND_NOUNS = {
  command: ["command", "commands"],
  read: ["read", "reads"],
  list: ["list", "lists"],
  search: ["search", "searches"],
  edit: ["edit", "edits"],
  web: ["web search", "web searches"],
  tool: ["tool call", "tool calls"],
} as const satisfies Record<ToolRunCallKind, readonly [string, string]>;

/** The failed calls of a run, or of the part of a run that it hides. */
export const countFailedCalls = (rows: readonly ToolRunRow[]): number =>
  rows.reduce(
    (count, row) => (getToolLifecyclePhase(row.message.meta) === "failed" ? count + 1 : count),
    0,
  );

/** A state of a run for its header, such as `2 failed` or `Running`. */
export type ToolRunState = { key: "failed" | "cancelled" | "running"; label: string };

/**
 * The states of a run for its header: its failed and cancelled calls, and whether a folded run
 * runs. An open run shows its running calls in their lines, so its header does not repeat it.
 */
export const readToolRunStates = (summary: ToolRunSummary, folded: boolean): ToolRunState[] => {
  const states: ToolRunState[] = [];
  if (summary.failedCount > 0)
    states.push({ key: "failed", label: `${summary.failedCount} failed` });
  if (summary.cancelledCount > 0) {
    states.push({ key: "cancelled", label: `${summary.cancelledCount} cancelled` });
  }
  if (folded && summary.activeCount > 0) states.push({ key: "running", label: "Running" });
  return states;
};

/**
 * The calls of a run by kind, such as `3 commands`, `2 reads`, and `1 search`. The edits count the
 * files that they change, so a patch of five files counts as five edits.
 */
export const readToolRunCountLabels = ({ kindCounts, fileEditCount }: ToolRunSummary): string[] =>
  TOOL_RUN_CALL_KINDS.flatMap((kind) => {
    const count = kind === "edit" ? fileEditCount : kindCounts[kind];
    return count > 0 ? [`${count} ${KIND_NOUNS[kind][count === 1 ? 0 : 1]}`] : [];
  });

/** The name of a run in its header, from the kinds of its calls. */
export type ToolRunTitle = "Shell" | "Files" | "Web" | "Tools";

export const readToolRunTitle = ({ callCount, kindCounts }: ToolRunSummary): ToolRunTitle => {
  const lookupCount = kindCounts.read + kindCounts.list + kindCounts.search;
  if (lookupCount + kindCounts.edit === callCount) return "Files";
  if (kindCounts.command + lookupCount === callCount) return "Shell";
  if (kindCounts.web === callCount) return "Web";
  return "Tools";
};

/** The tool run rows that start at `index`. */
const collectToolRun = (
  rows: readonly AgentChatTranscriptRow[],
  index: number,
  classify: ToolRunClassifier,
): ToolRunRow[] => {
  const run: ToolRunRow[] = [];
  for (let cursor = index; cursor < rows.length; cursor += 1) {
    const row = rows[cursor];
    if (!row || !isToolRunRow(row, classify)) break;
    run.push(row);
  }
  return run;
};

/**
 * A run of consecutive tool run calls of a transcript, with its counts. A run keeps its object
 * while its calls do not change, so its readers compare it at once.
 */
export type ToolRun = {
  /** The key of the first row of the run. It keys the folds of the run. */
  runKey: string;
  rows: readonly ToolRunRow[];
  summary: ToolRunSummary;
};

/** A part of a transcript: a row alone, or a tool run that starts at `index`. */
export type ToolRunSegment =
  | { kind: "row"; row: AgentChatTranscriptRow; index: number }
  | { kind: "tool_run"; run: ToolRun; index: number };

// The runs of the last groups, by classifier and by the first row of each run.
const knownRuns = new WeakMap<ToolRunClassifier, WeakMap<ToolRunRow, ToolRun>>();

const hasSameRows = (left: readonly ToolRunRow[], right: readonly ToolRunRow[]): boolean =>
  left.length === right.length && left.every((row, index) => row === right[index]);

const readToolRun = (
  first: ToolRunRow,
  rows: readonly ToolRunRow[],
  classify: ToolRunClassifier,
): ToolRun => {
  let known = knownRuns.get(classify);
  if (!known) {
    known = new WeakMap();
    knownRuns.set(classify, known);
  }
  const previous = known.get(first);
  if (previous && hasSameRows(previous.rows, rows)) return previous;
  const run: ToolRun = { runKey: first.key, rows, summary: summarizeToolRun(rows, classify) };
  known.set(first, run);
  return run;
};

type GroupedRows = {
  rows: readonly AgentChatTranscriptRow[];
  segments: readonly ToolRunSegment[];
};

// The last groups of each classifier. A streamed change gives new objects only to the rows of the
// messages that changed, so the segments before the first changed row stay.
const lastGroups = new WeakMap<ToolRunClassifier, GroupedRows>();

/** The index of the first row that differs, or the length of the shorter list. */
const firstChangedRow = (
  previous: readonly AgentChatTranscriptRow[],
  rows: readonly AgentChatTranscriptRow[],
): number => {
  const length = Math.min(previous.length, rows.length);
  for (let index = 0; index < length; index += 1) {
    if (previous[index] !== rows[index]) return index;
  }
  return length;
};

/** The index of the row after a segment. */
const segmentEnd = (segment: ToolRunSegment): number =>
  segment.index + (segment.kind === "row" ? 1 : segment.run.rows.length);

/**
 * The segments of the last groups that end before `changed`. A run that ends at `changed` can
 * take the call at `changed`, so it is grouped again.
 */
const keptSegments = (last: GroupedRows, changed: number): ToolRunSegment[] => {
  const kept: ToolRunSegment[] = [];
  for (const segment of last.segments) {
    if (segmentEnd(segment) >= changed) break;
    kept.push(segment);
  }
  return kept;
};

/**
 * The rows of a transcript in their tool runs. Consecutive tool run calls make one run, and a call
 * alone makes a run of one, so its header does not appear when the next call comes. Each event
 * groups only the rows from its first changed row on.
 */
export const groupToolRuns = (
  rows: readonly AgentChatTranscriptRow[],
  classify: ToolRunClassifier,
): readonly ToolRunSegment[] => {
  const last = lastGroups.get(classify);
  if (last?.rows === rows) return last.segments;
  const segments = last ? keptSegments(last, firstChangedRow(last.rows, rows)) : [];
  const lastSegment = segments.at(-1);
  let index = lastSegment ? segmentEnd(lastSegment) : 0;
  while (index < rows.length) {
    const row = rows[index];
    if (!row) break;
    const calls = collectToolRun(rows, index, classify);
    const [first] = calls;
    if (!first) {
      segments.push({ kind: "row", row, index });
      index += 1;
      continue;
    }
    segments.push({ kind: "tool_run", run: readToolRun(first, calls, classify), index });
    index += calls.length;
  }
  lastGroups.set(classify, { rows, segments });
  return segments;
};

/** A long open run shows this many of its latest calls, under a control that shows the others. */
export const TOOL_RUN_LATEST_CALL_COUNT = 5;

// The control takes the place of one call, so a run shows six lines at most until the reader asks
// for its earlier calls.
const MAX_SHOWN_CALL_COUNT = TOOL_RUN_LATEST_CALL_COUNT + 1;

// A run can hold hundreds of calls, so the control shows its earlier calls a page at a time.
const EARLIER_CALL_PAGE_SIZE = 25;

/** The earlier calls of an open run: the calls that it hides, and the calls that the reader showed. */
export type EarlierCalls = { earlierCallCount: number; shownEarlierCount: number };

/**
 * The earlier calls of an open run. A run of six calls or fewer shows them all. A longer run hides
 * all the calls before its latest ones, until the reader shows some of them. The calls that the
 * reader showed stay shown while new calls come, so `keptHidden` is the count of the calls that
 * stay hidden then.
 */
export const readEarlierCalls = (
  callCount: number,
  keptHidden: number | undefined,
): EarlierCalls => {
  if (callCount <= MAX_SHOWN_CALL_COUNT) return { earlierCallCount: 0, shownEarlierCount: 0 };
  const hidden = keptHidden ?? callCount - TOOL_RUN_LATEST_CALL_COUNT;
  return {
    earlierCallCount: hidden,
    shownEarlierCount: callCount - TOOL_RUN_LATEST_CALL_COUNT - hidden,
  };
};

/**
 * The earlier calls that the next press on the control shows: a page, or all of them when a page
 * would leave only a few.
 */
export const readEarlierCallStep = (earlierCallCount: number): number =>
  earlierCallCount <= EARLIER_CALL_PAGE_SIZE + TOOL_RUN_LATEST_CALL_COUNT
    ? earlierCallCount
    : EARLIER_CALL_PAGE_SIZE;

/** The label of the control that shows earlier calls, such as `Show 25 of 180 earlier calls`. */
export const readShowEarlierCallsLabel = (earlierCallCount: number): string => {
  const step = readEarlierCallStep(earlierCallCount);
  const calls = plural(earlierCallCount, "earlier call");
  return step < earlierCallCount ? `Show ${step} of ${calls}` : `Show ${calls}`;
};

/** The label of the control that hides the shown earlier calls, such as `Hide 25 earlier calls`. */
export const readHideEarlierCallsLabel = (shownEarlierCount: number): string =>
  `Hide ${plural(shownEarlierCount, "earlier call")}`;
