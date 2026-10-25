import type {
  AgentNativeFileReference,
  AgentToolData,
  AgentToolImage,
  AgentToolResultContent,
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
import { relativizeDisplayPathsInValue } from "./tool-path-utils";
import { buildToolSummary } from "./tool-summary";

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

export const hasExpandableToolDetails = ({
  hasInput,
  hasOutput,
  hasError,
}: ToolDetailAvailability): boolean => hasInput || hasOutput || hasError;

/** The compact summary text of a regular Tool Call, with the failure or cancel fallback. */
export const resolveRegularToolSummaryText = (
  meta: ToolMeta,
  messageContent: string,
  workingDirectory?: string | null,
): string => {
  const summary = buildToolSummary(meta, messageContent, workingDirectory);
  if (summary.length > 0) return summary;
  const phase = getToolLifecyclePhase(meta);
  if (phase === "failed") return "Tool failed";
  if (phase === "cancelled") return "Tool cancelled";
  return "";
};

/**
 * A pending call that reports its argument stream prepares to run. Its line reads
 * `Preparing <name>` in muted colors.
 */
export const isRegularToolPreparing = (meta: ToolMeta): boolean =>
  meta.status === "pending" && meta.inputStreaming !== undefined;

/** The name on a regular Tool Call line. */
export const regularToolLineName = (meta: ToolMeta, displayName: string): string =>
  isRegularToolPreparing(meta) ? `Preparing ${displayName}` : displayName;

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
