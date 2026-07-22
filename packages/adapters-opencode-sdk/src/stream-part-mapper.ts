import type { Part } from "@opencode-ai/sdk/v2/client";
import { type FileContent, type FileDiff, odtToolErrorPayloadSchema } from "@openducktor/contracts";
import {
  type AgentStreamPart,
  countRenderableFileDiffLines,
  selectRenderableFileDiff,
} from "@openducktor/core";
import {
  asUnknownRecord,
  readBooleanProp,
  readNumberProp,
  readRecordProp,
  readStringProp,
  readUnknownProp,
} from "./guards";
import { toTokenTotal } from "./message-normalizers";
import { deriveToolPreview, deriveToolType } from "./tool-preview";
import { resolveOpencodeToolStrategy } from "./tool-strategy-catalog";

const toDisplayText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) && value.length === 0) {
    return undefined;
  }
  const valueRecord = asUnknownRecord(value);
  if (valueRecord && Object.keys(valueRecord).length === 0) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const parseStructuredTextObject = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return asUnknownRecord(parsed);
  } catch {
    return undefined;
  }
};

const outputTextFromMcpPayload = (value: unknown): string | undefined => {
  const content = readUnknownProp(value, "content");
  if (!Array.isArray(content)) {
    return undefined;
  }

  const textChunks = content
    .map((entry) => {
      const entryRecord = asUnknownRecord(entry);
      if (!entryRecord) {
        return null;
      }
      const text = readUnknownProp(entryRecord, "text");
      return typeof text === "string" ? text.trim() : null;
    })
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (textChunks.length === 0) {
    return undefined;
  }
  return textChunks.join("\n");
};

const readToolOutputText = (value: unknown): string | undefined => {
  return outputTextFromMcpPayload(value) ?? toDisplayText(value);
};

const MCP_TRANSPORT_ERROR_PREFIX = /^MCP error\s+-?\d+:/i;

const readErrorValueMessage = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  return readTrimmedString(record, ["message"]);
};

const readEnvelopeErrorMessage = (value: unknown): string | undefined => {
  const record = asUnknownRecord(value) ?? parseStructuredTextObject(value);
  if (!record) {
    return undefined;
  }

  if (readUnknownProp(record, "ok") !== false) {
    return undefined;
  }

  const parsedOdtError = odtToolErrorPayloadSchema.safeParse(record);
  if (parsedOdtError.success) {
    const message = parsedOdtError.data.error.message.trim();
    return message.length > 0 ? message : "Tool failed";
  }

  return readErrorValueMessage(readUnknownProp(record, "error")) ?? "Tool failed";
};

const readMcpTransportError = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return MCP_TRANSPORT_ERROR_PREFIX.test(trimmed) ? trimmed : undefined;
};

const readMcpContentTextError = (value: unknown): string | undefined => {
  const text = outputTextFromMcpPayload(value);
  if (!text) {
    return undefined;
  }

  return readEnvelopeErrorMessage(text) ?? readMcpTransportError(text);
};

const readStructuredToolError = (value: unknown): string | undefined => {
  const record = asUnknownRecord(value) ?? parseStructuredTextObject(value);
  const contentTextError = readMcpContentTextError(record ?? value);
  const transportError = readMcpTransportError(value);
  if (!record) {
    return contentTextError ?? transportError;
  }

  const isError = readUnknownProp(record, "isError");
  const directError = readUnknownProp(record, "error");
  const directErrorMessage = readErrorValueMessage(directError);
  const structuredContent = readUnknownProp(record, "structuredContent");
  const structuredError = readUnknownProp(structuredContent, "error");
  const structuredErrorMessage = readErrorValueMessage(structuredError);
  const structuredOk = readUnknownProp(structuredContent, "ok");
  const flattenedEnvelopeMessage = readEnvelopeErrorMessage(record);
  const structuredEnvelopeMessage = readEnvelopeErrorMessage(structuredContent);

  if (flattenedEnvelopeMessage) {
    return flattenedEnvelopeMessage;
  }
  if (structuredEnvelopeMessage) {
    return structuredEnvelopeMessage;
  }
  if (contentTextError || transportError) {
    return contentTextError ?? transportError;
  }
  if (isError === true || structuredOk === false) {
    return (
      directErrorMessage ??
      structuredErrorMessage ??
      outputTextFromMcpPayload(value) ??
      toDisplayText(value) ??
      "Tool failed"
    );
  }

  return undefined;
};

const normalizeMetadata = (value: unknown): Record<string, unknown> | undefined => {
  const normalized = asUnknownRecord(value);
  if (!normalized) {
    return undefined;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeFileDiffType = (value: unknown): FileDiff["type"] => {
  if (typeof value !== "string") {
    return "modified";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "add" || normalized === "added") {
    return "added";
  }
  if (normalized === "delete" || normalized === "deleted") {
    return "deleted";
  }
  return "modified";
};

const readFileDiffPatch = (value: Record<string, unknown>): string | null => {
  const patch = readStringProp(value, ["patch"]);
  if (patch !== undefined) {
    return patch;
  }
  return readStringProp(value, ["diff"]) ?? null;
};

const normalizeToolMetadataFileDiff = (input: {
  file: string | undefined;
  diffFile?: string | undefined;
  type: FileDiff["type"];
  patch: string | null;
  additions: number | undefined;
  deletions: number | undefined;
}): FileDiff | null => {
  const file = input.file?.trim();
  if (!file || input.patch === null) {
    return null;
  }

  const diffFile = input.diffFile?.trim();
  const fileCandidates = diffFile && diffFile !== file ? [diffFile, file] : [file];
  let diff = "";
  for (const fileCandidate of fileCandidates) {
    const renderableDiff = selectRenderableFileDiff(input.patch, fileCandidate, {
      changeType: input.type,
    });
    if (renderableDiff) {
      diff = renderableDiff;
      break;
    }
  }
  const counts = countRenderableFileDiffLines(diff);
  return {
    file,
    type: input.type,
    additions: input.additions ?? counts.additions,
    deletions: input.deletions ?? counts.deletions,
    diff,
  };
};

const fileDiffFromToolFileMetadata = (value: unknown): FileDiff | null => {
  const record = asUnknownRecord(value);
  if (!record) {
    return null;
  }

  return normalizeToolMetadataFileDiff({
    file: readStringProp(record, ["relativePath"]) ?? readStringProp(record, ["filePath"]),
    diffFile: readStringProp(record, ["filePath"]),
    type: normalizeFileDiffType(readUnknownProp(record, "type")),
    patch: readFileDiffPatch(record),
    additions: readNumberProp(record, ["additions"]),
    deletions: readNumberProp(record, ["deletions"]),
  });
};

const fileDiffFromToolFileDiffMetadata = (value: unknown, input: unknown): FileDiff | null => {
  const record = asUnknownRecord(value);
  if (!record) {
    return null;
  }
  const inputRecord = asUnknownRecord(input);
  const oldString = readUnknownProp(inputRecord, "oldString");

  return normalizeToolMetadataFileDiff({
    file:
      readStringProp(record, ["file"]) ??
      readStringProp(inputRecord, ["filePath", "file_path", "path", "file"]),
    type:
      typeof oldString === "string" && oldString.length === 0
        ? "added"
        : normalizeFileDiffType(readUnknownProp(record, "status")),
    patch: readFileDiffPatch(record),
    additions: readNumberProp(record, ["additions"]),
    deletions: readNumberProp(record, ["deletions"]),
  });
};

const fileDiffFromWriteMetadata = (
  metadata: Record<string, unknown>,
  input: unknown,
): FileDiff | null => {
  const inputRecord = asUnknownRecord(input);
  const exists = readBooleanProp(metadata, ["exists"]);
  const file =
    readStringProp(metadata, ["filepath", "filePath", "file"]) ??
    readStringProp(inputRecord, ["filePath", "file_path", "path", "file"]);
  const type: FileDiff["type"] = exists === false ? "added" : "modified";
  const diff = readStringProp(metadata, ["diff"]);

  if (diff !== undefined) {
    return normalizeToolMetadataFileDiff({
      file,
      type,
      patch: diff,
      additions: readNumberProp(metadata, ["additions"]),
      deletions: readNumberProp(metadata, ["deletions"]),
    });
  }

  if (exists !== false) {
    return null;
  }

  return normalizeToolMetadataFileDiff({
    file,
    type,
    patch: readStringProp(inputRecord, ["content"]) ?? null,
    additions: readNumberProp(metadata, ["additions"]),
    deletions: readNumberProp(metadata, ["deletions"]),
  });
};

const fileContentFromWriteMetadata = (
  metadata: Record<string, unknown>,
  input: unknown,
): FileContent | null => {
  const inputRecord = asUnknownRecord(input);
  const exists = readBooleanProp(metadata, ["exists"]);
  if (!inputRecord || exists !== true || readStringProp(metadata, ["diff"]) !== undefined) {
    return null;
  }

  const file =
    readStringProp(metadata, ["filepath", "filePath", "file"]) ??
    readStringProp(inputRecord, ["filePath", "file_path", "path", "file"]);
  const content = readStringProp(inputRecord, ["content"]);
  if (!file || content === undefined) {
    return null;
  }

  return {
    file,
    type: "modified",
    content,
  };
};

type FileEditPayloadFields = {
  fileDiffs?: FileDiff[];
  fileContent?: FileContent[];
};

const readToolMetadataFileEditPayload = (
  metadata: Record<string, unknown> | undefined,
  toolState: Record<string, unknown>,
  tool: string,
): FileEditPayloadFields => {
  if (!metadata) {
    return {};
  }

  const fileDiffs: FileDiff[] = [];
  if (tool === "write") {
    const writeDiff = fileDiffFromWriteMetadata(metadata, readUnknownProp(toolState, "input"));
    if (writeDiff) {
      fileDiffs.push(writeDiff);
    }
  }

  const filediff = fileDiffFromToolFileDiffMetadata(
    readUnknownProp(metadata, "filediff"),
    readUnknownProp(toolState, "input"),
  );
  if (filediff) {
    fileDiffs.push(filediff);
  }

  const files = readUnknownProp(metadata, "files");
  if (Array.isArray(files)) {
    for (const file of files) {
      const fileDiff = fileDiffFromToolFileMetadata(file);
      if (fileDiff) {
        fileDiffs.push(fileDiff);
      }
    }
  }

  if (fileDiffs.length > 0) {
    return { fileDiffs };
  }

  if (tool !== "write") {
    return {};
  }

  const fileContent = fileContentFromWriteMetadata(metadata, readUnknownProp(toolState, "input"));
  return fileContent ? { fileContent: [fileContent] } : {};
};

const extractPartTiming = (
  part: Part,
): {
  startedAtMs?: number;
  endedAtMs?: number;
} => {
  const directTime = readRecordProp(part, "time");
  const fromDirectStart = readNumberProp(directTime, ["start"]);
  const fromDirectEnd = readNumberProp(directTime, ["end"]);

  const stateTime = readRecordProp(readRecordProp(part, "state"), "time");
  const fromStateStart = readNumberProp(stateTime, ["start"]);
  const fromStateEnd = readNumberProp(stateTime, ["end"]);

  const startedAtMs = fromDirectStart ?? fromStateStart;
  const endedAtMs = fromDirectEnd ?? fromStateEnd;

  return {
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
  };
};

type ToolPart = Extract<Part, { type: "tool" }>;
type ToolStreamPart = Extract<AgentStreamPart, { kind: "tool" }>;
type SubagentStreamPart = Extract<AgentStreamPart, { kind: "subagent" }>;
type ToolStatus = ToolStreamPart["status"];

const readTrimmedString = (source: unknown, keys: string[]): string | undefined => {
  const value = readStringProp(source, keys);
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isCancelledStatus = (value: string): boolean => {
  return value === "cancelled" || value === "canceled";
};

const normalizeSubagentExecutionMode = (value: unknown): SubagentStreamPart["executionMode"] => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "background" || normalized === "foreground") {
      return normalized;
    }
  }

  if (typeof value === "boolean") {
    return value ? "background" : "foreground";
  }

  return undefined;
};

const resolveSubagentExecutionMode = (
  ...sources: unknown[]
): SubagentStreamPart["executionMode"] => {
  for (const source of sources) {
    const direct = normalizeSubagentExecutionMode(source);
    if (direct) {
      return direct;
    }

    const record = asUnknownRecord(source);
    if (!record) {
      continue;
    }

    const fromMode = normalizeSubagentExecutionMode(
      readStringProp(record, ["executionMode", "execution_mode", "mode", "runMode", "run_mode"]),
    );
    if (fromMode) {
      return fromMode;
    }

    const fromBackground = normalizeSubagentExecutionMode(
      readBooleanProp(record, ["background", "isBackground", "is_background"]),
    );
    if (fromBackground) {
      return fromBackground;
    }
  }

  return undefined;
};

const resolveBackgroundJobId = (
  metadata: Record<string, unknown> | undefined,
): string | undefined => readTrimmedString(metadata, ["jobId", "jobID", "job_id"]);

const isRunningBackgroundSubagentResult = (
  metadata: Record<string, unknown> | undefined,
): boolean => {
  // OpenCode keeps the parent tool part carrying background job metadata; the synthetic task result is the terminal child update.
  return (
    resolveSubagentExecutionMode(metadata) === "background" &&
    resolveBackgroundJobId(metadata) !== undefined
  );
};

const omitEndedTiming = (
  timing: ReturnType<typeof extractPartTiming>,
): ReturnType<typeof extractPartTiming> => ({
  ...(typeof timing.startedAtMs === "number" ? { startedAtMs: timing.startedAtMs } : {}),
});

const resolveSubagentExternalSessionId = (...sources: unknown[]): string | undefined => {
  for (const source of sources) {
    const externalSessionId = readTrimmedString(source, [
      "externalSessionId",
      "sessionID",
      "sessionId",
      "session_id",
    ]);
    if (externalSessionId) {
      return externalSessionId;
    }
  }

  return undefined;
};

const resolveSubagentCorrelationKey = (input: {
  messageId: string;
  partId: string;
  externalSessionId?: string;
  agent?: string;
  prompt?: string;
}): string => {
  const agent = input.agent?.trim() ?? "";
  const prompt = input.prompt?.trim() ?? "";

  if (agent || prompt) {
    return ["spawn", input.messageId, agent, prompt].join(":");
  }

  if (input.externalSessionId) {
    return ["session", input.messageId, input.externalSessionId].join(":");
  }

  return ["part", input.messageId, input.partId].join(":");
};

const buildSubagentStreamPart = (input: {
  messageId: string;
  partId: string;
  status: SubagentStreamPart["status"];
  agent?: string;
  prompt?: string;
  description?: string;
  error?: string;
  externalSessionId?: string;
  executionMode?: SubagentStreamPart["executionMode"];
  metadata?: Record<string, unknown>;
  startedAtMs?: number;
  endedAtMs?: number;
}): SubagentStreamPart => {
  const correlationKey = resolveSubagentCorrelationKey({
    messageId: input.messageId,
    partId: input.partId,
    ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
  });

  return {
    kind: "subagent",
    messageId: input.messageId,
    partId: input.partId,
    correlationKey,
    status: input.status,
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : {}),
    ...(input.executionMode ? { executionMode: input.executionMode } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(typeof input.startedAtMs === "number" ? { startedAtMs: input.startedAtMs } : {}),
    ...(typeof input.endedAtMs === "number" ? { endedAtMs: input.endedAtMs } : {}),
  };
};

const resolveSubagentAgent = (...sources: unknown[]): string | undefined => {
  for (const source of sources) {
    const agent = readTrimmedString(source, ["agent", "name", "subagent_type", "subagentType"]);
    if (agent) {
      return agent;
    }
  }

  return undefined;
};

const resolveSubagentPrompt = (...sources: unknown[]): string | undefined => {
  for (const source of sources) {
    const prompt = readTrimmedString(source, ["prompt", "message"]);
    if (prompt) {
      return prompt;
    }
  }

  return undefined;
};

const resolveSubagentDescription = (...sources: unknown[]): string | undefined => {
  for (const source of sources) {
    const description = readTrimmedString(source, ["description", "result", "message"]);
    if (description) {
      return description;
    }
  }

  return undefined;
};

const buildSubagentFromToolPart = (
  part: ToolPart,
  toolState: Record<string, unknown>,
  normalizedStatus: SubagentStreamPart["status"],
  timing: ReturnType<typeof extractPartTiming>,
  metadata: Record<string, unknown> | undefined,
  structuredError: string | undefined,
): SubagentStreamPart => {
  const rawInput = readUnknownProp(toolState, "input");
  const rawOutput = readUnknownProp(toolState, "output");
  const input = asUnknownRecord(rawInput);
  const output = asUnknownRecord(rawOutput) ?? parseStructuredTextObject(rawOutput);
  const outputIdentity = asUnknownRecord(readUnknownProp(output, "metadata")) ?? output;
  const externalSessionId = resolveSubagentExternalSessionId(metadata, input, outputIdentity);
  const agent = resolveSubagentAgent(input, metadata, output);
  const prompt = resolveSubagentPrompt(input, metadata, output);
  const directError = toDisplayText(readUnknownProp(toolState, "error"));
  const error = structuredError ?? directError;
  const isBackgroundResultStillRunning = isRunningBackgroundSubagentResult(metadata);
  let status = normalizedStatus;
  if (error) {
    status = "error";
  } else if (isBackgroundResultStillRunning && status !== "cancelled") {
    status = "running";
  }
  let mappedTiming = timing;
  if (status === "running" && isBackgroundResultStillRunning) {
    mappedTiming = omitEndedTiming(timing);
  }
  const preview = deriveToolPreview({
    tool: part.tool,
    rawInput,
    rawOutput,
    ...(metadata ? { metadata } : {}),
  });
  const description =
    resolveSubagentDescription(input, output, metadata) ?? (error ? (prompt ?? preview) : preview);

  return buildSubagentStreamPart({
    messageId: part.messageID,
    partId: part.id,
    status,
    ...(agent ? { agent } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(error ? { error } : {}),
    ...(externalSessionId ? { externalSessionId } : {}),
    executionMode: resolveSubagentExecutionMode(metadata, input, output),
    ...(metadata ? { metadata } : {}),
    ...mappedTiming,
  });
};

const normalizeToolStatus = (rawStatus: string, hasEndedTiming: boolean): ToolStatus => {
  const normalized = rawStatus.trim().toLowerCase();
  if (normalized === "completed") {
    return "completed";
  }
  if (isCancelledStatus(normalized)) {
    return "error";
  }
  if (normalized === "error" || normalized === "failed") {
    return "error";
  }
  if (normalized === "pending") {
    return hasEndedTiming ? "completed" : "pending";
  }
  if (normalized === "running" || normalized === "started") {
    return hasEndedTiming ? "completed" : "running";
  }
  return hasEndedTiming ? "completed" : "running";
};

const normalizeSubagentStatus = (
  rawStatus: string,
  hasEndedTiming: boolean,
  hasStructuredError: boolean,
): SubagentStreamPart["status"] => {
  const normalized = rawStatus.trim().toLowerCase();
  if (hasStructuredError) {
    return "error";
  }
  if (normalized === "completed") {
    return "completed";
  }
  if (isCancelledStatus(normalized)) {
    return "cancelled";
  }
  if (normalized === "error" || normalized === "failed") {
    return "error";
  }
  if (normalized === "pending") {
    return hasEndedTiming ? "completed" : "pending";
  }
  if (normalized === "running" || normalized === "started") {
    return hasEndedTiming ? "completed" : "running";
  }
  return hasEndedTiming ? "completed" : "running";
};

const buildToolStreamPart = (
  part: ToolPart,
  toolState: Record<string, unknown>,
  normalizedStatus: ToolStatus,
  timing: ReturnType<typeof extractPartTiming>,
  metadata: Record<string, unknown> | undefined,
): ToolStreamPart => {
  const toolType = deriveToolType(part.tool);
  const fileEditPayload =
    toolType === "file_edit" ? readToolMetadataFileEditPayload(metadata, toolState, part.tool) : {};
  const preview = deriveToolPreview({
    tool: part.tool,
    rawInput: readUnknownProp(toolState, "input"),
    rawOutput: readUnknownProp(toolState, "output"),
    ...(metadata ? { metadata } : {}),
  });
  const base: ToolStreamPart = {
    kind: "tool",
    messageId: part.messageID,
    partId: part.id,
    callId: part.callID,
    tool: part.tool,
    toolType,
    status: normalizedStatus,
    input: part.state.input,
    ...(preview ? { preview } : {}),
    ...(metadata ? { metadata } : {}),
    ...fileEditPayload,
    ...timing,
  };

  if (normalizedStatus === "pending") {
    return base;
  }
  if (normalizedStatus === "running") {
    const title = toDisplayText(readUnknownProp(toolState, "title"));
    return {
      ...base,
      ...(title ? { title } : {}),
    };
  }

  const error = toDisplayText(readUnknownProp(toolState, "error"));
  const outputValue = readUnknownProp(toolState, "output");
  const structuredError = readStructuredToolError(outputValue) ?? readStructuredToolError(metadata);
  if (normalizedStatus === "error") {
    const resolvedError = structuredError ?? error;
    return resolvedError
      ? {
          ...base,
          error: resolvedError,
        }
      : base;
  }

  const output = readToolOutputText(outputValue);
  if (structuredError || (error && error.trim().length > 0)) {
    return {
      ...base,
      status: "error",
      error: structuredError ?? output ?? error ?? "Tool failed",
    };
  }

  const title = toDisplayText(readUnknownProp(toolState, "title"));
  const titleField = title ? { title } : {};
  return {
    ...base,
    ...(output ? { output } : {}),
    ...titleField,
  };
};

export const mapPartToAgentStreamPart = (part: Part): AgentStreamPart | null => {
  switch (part.type) {
    case "text":
      return {
        kind: "text",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        ...(part.synthetic !== undefined ? { synthetic: part.synthetic } : {}),
        completed: Boolean(part.time?.end),
      };
    case "reasoning":
      return {
        kind: "reasoning",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        completed: Boolean(part.time?.end),
      };
    case "tool": {
      const toolState = asUnknownRecord(part.state) ?? {};
      const timing = extractPartTiming(part);
      const metadata = normalizeMetadata(readUnknownProp(toolState, "metadata"));
      if (resolveOpencodeToolStrategy(part.tool).streamPartKind === "subagent") {
        const rawOutput = readUnknownProp(toolState, "output");
        const structuredError =
          readStructuredToolError(rawOutput) ?? readStructuredToolError(metadata);
        return buildSubagentFromToolPart(
          part,
          toolState,
          normalizeSubagentStatus(
            readStringProp(toolState, ["status"]) ?? "",
            typeof timing.endedAtMs === "number",
            structuredError !== undefined,
          ),
          timing,
          metadata,
          structuredError,
        );
      }

      const normalizedStatus = normalizeToolStatus(
        readStringProp(toolState, ["status"]) ?? "",
        typeof timing.endedAtMs === "number",
      );

      return buildToolStreamPart(part, toolState, normalizedStatus, timing, metadata);
    }
    case "step-start":
      return {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "start",
      };
    case "step-finish": {
      const totalTokens = toTokenTotal(readUnknownProp(part, "tokens"));
      return {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "finish",
        reason: part.reason,
        cost: part.cost,
        ...(typeof totalTokens === "number" ? { totalTokens } : {}),
      };
    }
    case "subtask": {
      const subtaskMetadata = normalizeMetadata({
        ...(part.model ? { model: part.model } : {}),
        ...(part.command ? { command: part.command } : {}),
      });

      return buildSubagentStreamPart({
        messageId: part.messageID,
        partId: part.id,
        status: "running",
        agent: part.agent,
        prompt: part.prompt,
        description: part.description,
        ...(subtaskMetadata ? { metadata: subtaskMetadata } : {}),
      });
    }
    default:
      return null;
  }
};
