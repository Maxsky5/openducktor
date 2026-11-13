import type {
  AgentNativeFileReference,
  AgentToolData,
  AgentToolImage,
  AgentToolResultContent,
  OdtToolName,
  PullRequest,
} from "@openducktor/contracts";
import { buildContentEntries } from "../transcript/agent-chat-content-keys";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { extractAllFileEditData, type FileEditData } from "./file-edit-tool";
import { type QuestionToolDetail, questionToolDetails } from "./question-tool-parser";
import { getToolDuration } from "./tool-duration";
import {
  getToolLifecyclePhase,
  hasNonEmptyInput,
  hasNonEmptyText,
  isToolMessageActive,
  isToolMessageFailure,
  type ToolLifecyclePhase,
} from "./tool-lifecycle";
import { isShellCommandCall } from "./shell-command-call";
import { extractPathFromInput } from "./tool-input-utils";
import { relativizeDisplayPath, relativizeDisplayPathsInValue } from "./tool-path-utils";
import { ODT_TOOL_CARDS, type OdtToolIconKind } from "./odt-tool-call";
import { readArtifactToolCall } from "./artifact-tool-call";
import type { AgentChatToolCallPresentation } from "../send/agent-chat.types";
import { readToolCallError, type ToolCallError } from "./tool-call-error";
import { buildToolSummary } from "./tool-summary";
import { compactText } from "./tool-text-utils";

/** Which detail sections a Tool Call has. A call with any section can expand. */
export type ToolDetailAvailability = {
  hasInput: boolean;
  hasOutput: boolean;
  hasError: boolean;
};

export const readToolDetailAvailability = (meta: ToolMeta): ToolDetailAvailability => ({
  hasInput: hasNonEmptyInput(meta.input),
  hasOutput: Boolean(meta.resultContent?.length) || hasNonEmptyText(meta.output),
  hasError: hasNonEmptyText(meta.error),
});

/** The error that the details of a call show, or an empty text for a call without an error. */
export const readToolDetailsError = (meta: ToolMeta): string =>
  hasNonEmptyText(meta.error) ? meta.error : "";

/**
 * A workflow tool card. Its header shows the icon, the title, and the pull request of the call.
 * The line under the header shows the error message of a failed call. A press on the card shows
 * the call in the tool details, with the note of a workflow event.
 */
export type WorkflowToolCard = {
  /** The event of a workflow event call, or else the name of the tool. */
  title: string;
  /** Null for a tool with no icon of its own. */
  iconKind: OdtToolIconKind | null;
  pullRequest: PullRequest | null;
  /** The error of a failed call. */
  error: ToolCallError | null;
  /** The Markdown note of a workflow event. */
  note: string | null;
};

type WorkflowToolCardInput = {
  meta: ToolMeta;
  /** The ODT tool of the call, as `presentToolCall` resolved it. */
  odtTool: OdtToolName | null;
  displayName: string;
};

/** Reads what a workflow tool card shows. */
export const readWorkflowToolCard = ({
  meta,
  odtTool,
  displayName,
}: WorkflowToolCardInput): WorkflowToolCard => {
  const odtCard = odtTool === null ? undefined : ODT_TOOL_CARDS.get(odtTool);
  const content = odtCard?.read(meta);
  return {
    title: content?.title ?? displayName,
    iconKind: odtCard?.iconKind ?? null,
    pullRequest: content?.pullRequest ?? null,
    error: readToolCallError(meta),
    note: content?.note ?? null,
  };
};

/** The title, the icon, and the note of a call at the top of its details. */
export type ToolDetailsHeading = {
  title: string;
  /** Null for a tool with no icon of its own. */
  iconKind: OdtToolIconKind | null;
  /** The Markdown note of a workflow event. */
  note: string | null;
};

const CODE_FENCE = /^\s*(?:```|~~~)/;

/**
 * An agent writes the lines of a note one under the other, but Markdown joins the lines of a
 * paragraph. Each line that another line follows ends with a hard break, except in a code block.
 * A hard break at the end of a block, such as a list item, does nothing.
 */
const keepNoteLineBreaks = (note: string): string => {
  let inCodeBlock = false;
  const lines = note.split("\n");
  return lines
    .map((line, index) => {
      if (CODE_FENCE.test(line)) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      const next = lines[index + 1];
      if (inCodeBlock || next === undefined || !line.trim() || !next.trim()) return line;
      return `${line.trimEnd()}  `;
    })
    .join("\n");
};

/**
 * The details title of a workflow tool call: the tool name, then the card title when the card
 * names more than the tool, as `Workflow Event · Build Completed`.
 */
export const readWorkflowToolDetailsTitle = (displayName: string, cardTitle: string): string =>
  cardTitle === displayName ? cardTitle : `${displayName} · ${cardTitle}`;

/**
 * The heading of the details of a call that is not a shell command. The details name the tool that
 * the agent called, then what the call is about, as `Workflow Event · Build Completed` or
 * `Set Artifact · spec`. A workflow event shows its note.
 */
export const readToolDetailsHeading = (
  meta: ToolMeta,
  presentation: AgentChatToolCallPresentation,
): ToolDetailsHeading => {
  if (presentation.kind === "workflow") {
    const { title, iconKind, note } = readWorkflowToolCard({
      meta,
      odtTool: presentation.odtTool,
      displayName: presentation.displayName,
    });
    return {
      title: readWorkflowToolDetailsTitle(presentation.displayName, title),
      iconKind,
      note: note === null ? null : keepNoteLineBreaks(note),
    };
  }
  if (presentation.kind === "artifact" && presentation.operation === "set") {
    return { title: readArtifactToolCall(meta).title, iconKind: null, note: null };
  }
  return { title: presentation.displayName, iconKind: null, note: null };
};

export const hasExpandableToolDetails = ({
  hasInput,
  hasOutput,
  hasError,
}: ToolDetailAvailability): boolean => hasInput || hasOutput || hasError;

/**
 * The compact summary of a Tool Call, such as its command or path, and the error preview of a
 * failed call. The row shows the preview on its own line under the summary.
 */
export type ToolSummary = { text: string; errorPreview: string | null };

/**
 * The line of the error of a failed call that says why it failed, as one short line. The full
 * error shows in the details of the call. Null when the call did not fail.
 */
export const readToolErrorPreview = (meta: ToolMeta): string | null => {
  const error = readToolCallError(meta);
  return error ? compactText(errorPreviewLine(error.message), 220) : null;
};

/**
 * Some runtimes give all the output of a failed command as its error, so its first line can be
 * normal output, such as a warning or a progress line. The preview is the first line that names a
 * failure and the place in a file where it is, as compilers print it. Else it is the first line
 * that names a failure or a place, as linters print the place of each finding first. Else it is
 * the first line with text. Code frame lines quote the source, and summary lines only count the
 * failures, so the preview skips them. It reads only the start of a long output.
 */
const FAILURE_WORD =
  /\b(?:error|errors|fail|failed|failure|fatal|exception|panic|denied|not found|no such file)\b/i;
// A place in a file, such as `src/a.ts:12:3` or `src/a.ts(12,3)`.
const FILE_PLACE = /\S(?::\d+:\d+|\(\d+,\d+\))/;
// A line of a code frame, such as `  45 │ code`, `> 12 | code`, or a diff line `45 45 │ code`. It
// tests a line without its leading spaces, so a long run of spaces cannot slow it down.
const CODE_FRAME_LINE = /^>?\s*\d+(?:\s+\d+)?\s*[│|]/;
// A count of the failures that the lines before name, such as `Found 2 errors in 1 file.`
const SUMMARY_LINE = /^\s*found \d+ (?:errors?|warnings?)\b/i;
// The characters of the rule that some linters draw after the place of a diagnostic.
const RULE_CHARACTERS = new Set(["━", "─"]);

/** A line without the rule at its end, if it has one of three characters or more. */
const withoutTrailingRule = (line: string): string => {
  const trimmed = line.trimEnd();
  let ruleStart = trimmed.length;
  while (ruleStart > 0 && RULE_CHARACTERS.has(trimmed.charAt(ruleStart - 1))) ruleStart -= 1;
  return trimmed.length - ruleStart >= 3 ? trimmed.slice(0, ruleStart).trimEnd() : line;
};
const ERROR_PREVIEW_SCAN_LENGTH = 65_536;

/** The line of a failed output that says why it failed, and its place among the lines. */
export type FailureLine = { text: string; index: number };

/** The line of a failed output that says why it failed, or null when no line names a failure. */
export const findFailureLine = (text: string): FailureLine | null => {
  const lines = text.slice(0, ERROR_PREVIEW_SCAN_LENGTH).split("\n");
  let firstFinding: FailureLine | null = null;
  for (const [index, rawLine] of lines.entries()) {
    const line = withoutTrailingRule(rawLine);
    if (
      line.trim().length === 0 ||
      CODE_FRAME_LINE.test(line.trimStart()) ||
      SUMMARY_LINE.test(line)
    ) {
      continue;
    }
    const namesFailure = FAILURE_WORD.test(line);
    const hasPlace = FILE_PLACE.test(line);
    if (namesFailure && hasPlace) return { text: line, index };
    if (namesFailure || hasPlace) firstFinding ??= { text: line, index };
  }
  return firstFinding;
};

const errorPreviewLine = (text: string): string =>
  findFailureLine(text)?.text ?? firstNonEmptyLine(text.slice(0, ERROR_PREVIEW_SCAN_LENGTH));

/** The first line with text. */
const firstNonEmptyLine = (text: string): string => {
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf("\n", start);
    const line = text.slice(start, end < 0 ? text.length : end);
    if (line.trim().length > 0) return line;
    if (end < 0) break;
    start = end + 1;
  }
  return text;
};

/** The compact summary of a regular Tool Call, with the cancel fallback and the error preview. */
export const resolveRegularToolSummary = (
  meta: ToolMeta,
  messageContent: string,
  workingDirectory?: string | null,
): ToolSummary => {
  const errorPreview = readToolErrorPreview(meta);
  const text = buildToolSummary(meta, messageContent, workingDirectory);
  if (text.length > 0 || getToolLifecyclePhase(meta) !== "cancelled") {
    return { text, errorPreview };
  }
  return { text: "Tool cancelled", errorPreview };
};

/**
 * A pending call that reports its argument stream prepares to run. Its line reads
 * `Preparing <name>` in muted colors.
 */
export const isRegularToolPreparing = (meta: ToolMeta): boolean =>
  meta.status === "pending" && meta.inputStreaming !== undefined;

/**
 * The name of a tool call in the transcript. Each runtime names its tools in its own way, so a
 * shell command shows as `bash`, and a call that edits files, such as `Edit`, `Write`, or
 * `apply_patch`, shows as `edit`. The details of the call show the name of the tool.
 */
export const readToolCallName = (meta: ToolMeta, displayName: string): string => {
  if (isShellCommandCall(meta)) return "bash";
  if (meta.toolType === "file_edit") return "edit";
  return displayName;
};

/** The name on a regular Tool Call line, with the common names of `readToolCallName`. */
export const regularToolLineName = (meta: ToolMeta, displayName: string): string => {
  const name = readToolCallName(meta, displayName);
  return isRegularToolPreparing(meta) ? `Preparing ${name}` : name;
};

export const FILE_DIFF_UNAVAILABLE_MESSAGE =
  "File diff unavailable. The runtime did not return the applied changes.";

/** The file edits of a file edit call, and whether the runtime left out the applied changes. */
export type ToolFileEdits = { edits: FileEditData[]; diffUnavailable: boolean };

export const readToolFileEdits = (
  meta: ToolMeta,
  workingDirectory?: string | null,
): ToolFileEdits => {
  const edits = meta.toolType === "file_edit" ? extractAllFileEditData(meta, workingDirectory) : [];
  return {
    edits,
    diffUnavailable: meta.status === "completed" && edits.some((data) => data.kind === "path"),
  };
};

/**
 * A file edit shows its changes in its details when it has a change to show. A failed edit, or an
 * edit whose changes did not come yet, shows its input, so the reader sees what the agent tried.
 */
export const hasFileEditChanges = (meta: ToolMeta, workingDirectory?: string | null): boolean =>
  readToolFileEdits(meta, workingDirectory).edits.some((edit) => edit.kind !== "path");

/**
 * The file that a call reads or edits, relative to the working directory, or null for a call on
 * another file count or on no file. Its line shows the icon of the type of the file before it.
 */
export const readToolCallFilePath = (
  meta: ToolMeta,
  workingDirectory?: string | null,
): string | null => {
  if (meta.toolType === "read") {
    const path = extractPathFromInput(meta.input);
    return path ? relativizeDisplayPath(path, workingDirectory) : null;
  }
  if (meta.toolType !== "file_edit") return null;
  const { edits } = readToolFileEdits(meta, workingDirectory);
  return edits.length === 1 ? (edits[0]?.filePath ?? null) : null;
};

/** The questions and answers of a question tool, with keys that stay the same across renders. */
export const buildQuestionDetailEntries = (
  meta: ToolMeta,
): Array<{ key: string; detail: QuestionToolDetail }> => {
  const countsByBaseKey = new Map<string, number>();
  return questionToolDetails(meta).map((detail) => {
    const baseKey = `${meta.callId}:question:${detail.prompt}:${detail.answers.join("|")}`;
    const nextCount = (countsByBaseKey.get(baseKey) ?? 0) + 1;
    countsByBaseKey.set(baseKey, nextCount);
    return { key: `${baseKey}:${nextCount}`, detail };
  });
};

export const NO_ANSWER_YET_LABEL = "No answer yet";

/** Tool input as indented JSON, with paths shown relative to the working directory. */
export const formatToolInput = (input: AgentToolData, workingDirectory?: string | null): string =>
  JSON.stringify(relativizeDisplayPathsInValue(input, workingDirectory), null, 2);

const nativeFileIdentity = (file: AgentNativeFileReference): string =>
  JSON.stringify(["file", file.uri, file.name, file.mime]);

/** The result items of a Tool Call, with keys that keep equal items apart. */
export const toolResultContentEntries = (content: readonly AgentToolResultContent[]) =>
  buildContentEntries(content, (item) =>
    item.kind === "text" ? JSON.stringify(["text", item.text]) : nativeFileIdentity(item.file),
  );

/** The status label of a workflow tool row. A completed call shows no label. */
export const workflowToolStatusLabel = (phase: ToolLifecyclePhase): string | null => {
  switch (phase) {
    case "preparing":
      return "PREPARING";
    case "queued":
      return "PREPARING";
    case "executing":
      return "RUNNING";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    case "completed":
      return null;
  }
};

/** A workflow call that prepares or runs shows progress. */
export const isWorkflowToolActive = (phase: ToolLifecyclePhase): boolean =>
  phase === "preparing" || phase === "executing";

/** The timing of a Tool Call row: progress while it runs, then its run time. */
export type ToolTiming = { isActive: boolean; durationMs: number | null };

export const readToolTiming = (meta: ToolMeta, messageTimestamp: string): ToolTiming => ({
  isActive: isToolMessageActive(meta),
  durationMs: getToolDuration(meta, messageTimestamp),
});

/** The timing of a regular Tool Call row. A pending call with complete arguments shows no progress. */
export const readRegularToolTiming = (meta: ToolMeta, messageTimestamp: string): ToolTiming => ({
  isActive:
    isToolMessageActive(meta) && (meta.status !== "pending" || meta.inputStreaming !== false),
  durationMs: getToolDuration(meta, messageTimestamp),
});

export const DEFAULT_COMPUTER_USE_ACTION_TITLE = "Computer action";

export type ComputerUsePresentation = {
  actionTitle: string;
  isFailed: boolean;
  code: string;
  errorText: string;
  outputText: string;
  hasDetails: boolean;
  screenshots: readonly AgentToolImage[];
  screenshotLabel: string | null;
};

/** The summary and details of a Computer Use call. */
export const buildComputerUsePresentation = (meta: ToolMeta): ComputerUsePresentation => {
  const action = meta.computerUse;
  const code = action?.code ?? "";
  const errorText = hasNonEmptyText(meta.error) ? meta.error : "";
  const outputText = hasNonEmptyText(meta.output) ? meta.output : "";
  const screenshots = action?.images ?? [];
  return {
    actionTitle: action?.action ?? DEFAULT_COMPUTER_USE_ACTION_TITLE,
    isFailed: isToolMessageFailure(meta),
    code,
    errorText,
    outputText,
    hasDetails: code.length > 0 || errorText.length > 0 || outputText.length > 0,
    screenshots,
    screenshotLabel: computerUseScreenshotLabel(screenshots.length),
  };
};

export const computerUseScreenshotLabel = (count: number): string | null => {
  if (count <= 0) return null;
  return count > 1 ? `Screenshots (${count})` : "Screenshot";
};

/** A data URI of a Computer Use screenshot, for an image view. */
export const computerUseScreenshotUri = (image: AgentToolImage): string =>
  `data:${image.mimeType};base64,${image.dataBase64}`;
