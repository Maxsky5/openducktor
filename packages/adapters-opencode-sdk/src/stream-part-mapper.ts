import {
  type FileContent,
  type FileDiff,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  jsonValueSchema,
  odtToolErrorPayloadSchema,
} from "@openducktor/contracts";
import {
  type AgentStreamPart,
  countRenderableFileDiffLines,
  selectRenderableFileDiff,
} from "@openducktor/core";
import { asUnknownRecord, readBooleanProp, readNumberProp, readStringProp } from "./guards";
import { toTokenTotal } from "./message-normalizers";
import { deriveToolPreview, deriveToolType } from "./tool-preview";
import { resolveOpencodeToolStrategy } from "./tool-strategy-catalog";
import { opencodePartPayloadSchema, type ParsedOpencodePart } from "./opencode-ingress";

const toDisplayText = (value: unknown): string | undefined => {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const displayValue = parsed.data;
  if (typeof displayValue === "string") {
    const trimmed = displayValue.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (displayValue === null) {
    return undefined;
  }
  if (typeof displayValue === "number" || typeof displayValue === "boolean") {
    return String(displayValue);
  }
  if (Array.isArray(displayValue) && displayValue.length === 0) {
    return undefined;
  }
  const valueRecord = asUnknownRecord(displayValue);
  if (valueRecord && Object.keys(valueRecord).length === 0) {
    return undefined;
  }
  return JSON.stringify(displayValue, null, 2);
};

const parseStructuredTextObject = (value: string | undefined): JsonObject | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(trimmed));
    return parsed.success && isJsonObject(parsed.data) ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const outputTextFromMcpPayload = (value: JsonObject | undefined): string | undefined => {
  const content = value?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const textChunks = content
    .map((entry) => {
      const entryRecord = asUnknownRecord(entry);
      if (!entryRecord) {
        return null;
      }
      const text = entryRecord.text;
      return typeof text === "string" ? text.trim() : null;
    })
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (textChunks.length === 0) {
    return undefined;
  }
  return textChunks.join("\n");
};

const readToolOutputText = (value: string | undefined): string | undefined => toDisplayText(value);

const MCP_TRANSPORT_ERROR_PREFIX = /^MCP error\s+-?\d+:/i;

const readErrorValueMessage = (value: JsonValue | undefined): string | undefined => {
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

const readEnvelopeErrorMessage = (value: string | JsonObject | undefined): string | undefined => {
  const record = typeof value === "string" ? parseStructuredTextObject(value) : value;
  if (!record) {
    return undefined;
  }

  if (record.ok !== false) {
    return undefined;
  }

  const parsedOdtError = odtToolErrorPayloadSchema.safeParse(record);
  if (parsedOdtError.success) {
    const message = parsedOdtError.data.error.message.trim();
    return message.length > 0 ? message : "Tool failed";
  }

  return readErrorValueMessage(record.error) ?? "Tool failed";
};

const readMcpTransportError = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return MCP_TRANSPORT_ERROR_PREFIX.test(trimmed) ? trimmed : undefined;
};

const readMcpContentTextError = (value: JsonObject | undefined): string | undefined => {
  const text = outputTextFromMcpPayload(value);
  if (!text) {
    return undefined;
  }

  return readEnvelopeErrorMessage(text) ?? readMcpTransportError(text);
};

const readStructuredToolError = (value: string | JsonObject | undefined): string | undefined => {
  const record = typeof value === "string" ? parseStructuredTextObject(value) : value;
  const contentTextError = readMcpContentTextError(record);
  const transportError = readMcpTransportError(typeof value === "string" ? value : undefined);
  if (!record) {
    return contentTextError ?? transportError;
  }

  const isError = record.isError;
  const directError = record.error;
  const directErrorMessage = readErrorValueMessage(directError);
  const structuredContentValue = record.structuredContent;
  const parsedStructuredContent = jsonValueSchema.safeParse(structuredContentValue);
  const structuredContent =
    parsedStructuredContent.success && isJsonObject(parsedStructuredContent.data)
      ? parsedStructuredContent.data
      : undefined;
  const structuredError = structuredContent?.error;
  const structuredErrorMessage = readErrorValueMessage(structuredError);
  const structuredOk = structuredContent?.ok;
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
      outputTextFromMcpPayload(record) ??
      toDisplayText(value) ??
      "Tool failed"
    );
  }

  return undefined;
};

const normalizeJsonObject = (value: unknown): JsonObject | undefined => {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success || !isJsonObject(parsed.data)) {
    return undefined;
  }
  return parsed.data;
};

const normalizeMetadata = (value: Record<string, unknown> | undefined): JsonObject | undefined => {
  const normalized = normalizeJsonObject(value);
  return normalized && Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeFileDiffType = (value: unknown): FileDiff["type"] => {
  if (!(typeof value === "string")) {
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

const fileDiffFromToolFileMetadata = (value: JsonValue): FileDiff | null => {
  const record = asUnknownRecord(value);
  if (!record) {
    return null;
  }

  return normalizeToolMetadataFileDiff({
    file: readStringProp(record, ["relativePath"]) ?? readStringProp(record, ["filePath"]),
    diffFile: readStringProp(record, ["filePath"]),
    type: normalizeFileDiffType(record.type),
    patch: readFileDiffPatch(record),
    additions: readNumberProp(record, ["additions"]),
    deletions: readNumberProp(record, ["deletions"]),
  });
};

const fileDiffFromToolFileDiffMetadata = (
  value: JsonValue | undefined,
  input: Record<string, unknown>,
): FileDiff | null => {
  const record = asUnknownRecord(value);
  if (!record) {
    return null;
  }
  const inputRecord = asUnknownRecord(input);
  const oldString = inputRecord?.oldString;

  return normalizeToolMetadataFileDiff({
    file:
      readStringProp(record, ["file"]) ??
      readStringProp(inputRecord, ["filePath", "file_path", "path", "file"]),
    type:
      typeof oldString === "string" && oldString.length === 0
        ? "added"
        : normalizeFileDiffType(record.status),
    patch: readFileDiffPatch(record),
    additions: readNumberProp(record, ["additions"]),
    deletions: readNumberProp(record, ["deletions"]),
  });
};

const fileDiffFromWriteMetadata = (
  metadata: JsonObject,
  input: Record<string, unknown>,
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
  metadata: JsonObject,
  input: Record<string, unknown>,
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
type ToolPart = Extract<ParsedOpencodePart, { type: "tool" }>;

const readToolMetadataFileEditPayload = (
  metadata: JsonObject | undefined,
  toolState: ToolPart["state"],
  tool: string,
): FileEditPayloadFields => {
  if (!metadata) {
    return {};
  }

  const fileDiffs: FileDiff[] = [];
  if (tool === "write") {
    const writeDiff = fileDiffFromWriteMetadata(metadata, toolState.input);
    if (writeDiff) {
      fileDiffs.push(writeDiff);
    }
  }

  const filediff = fileDiffFromToolFileDiffMetadata(metadata.filediff, toolState.input);
  if (filediff) {
    fileDiffs.push(filediff);
  }

  const files = metadata.files;
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

  const fileContent = fileContentFromWriteMetadata(metadata, toolState.input);
  return fileContent ? { fileContent: [fileContent] } : {};
};

const extractPartTiming = (toolState: ToolPart["state"]) => {
  const stateTime = "time" in toolState ? toolState.time : undefined;
  const startedAtMs = stateTime?.start;
  const endedAtMs = stateTime && "end" in stateTime ? stateTime.end : undefined;

  return {
    ...(typeof startedAtMs === "number" ? { startedAtMs } : undefined),
    ...(typeof endedAtMs === "number" ? { endedAtMs } : undefined),
  } satisfies {
    startedAtMs?: number;
    endedAtMs?: number;
  };
};

type ToolStreamPart = Extract<AgentStreamPart, { kind: "tool" }>;
type SubagentStreamPart = Extract<AgentStreamPart, { kind: "subagent" }>;

const readTrimmedString = (
  source: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined => {
  const value = readStringProp(source, keys);
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeSubagentExecutionMode = (value: unknown): SubagentStreamPart["executionMode"] => {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  if (typeof parsed.data === "string") {
    const normalized = parsed.data.trim().toLowerCase();
    if (normalized === "background" || normalized === "foreground") {
      return normalized;
    }
  }

  if (typeof parsed.data === "boolean") {
    return parsed.data ? "background" : "foreground";
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

const resolveBackgroundJobId = (metadata: JsonObject | undefined): string | undefined =>
  readTrimmedString(metadata, ["jobId", "jobID", "job_id"]);

const isRunningBackgroundSubagentResult = (metadata: JsonObject | undefined): boolean => {
  // OpenCode keeps the parent tool part carrying background job metadata; the synthetic task result is the terminal child update.
  return (
    resolveSubagentExecutionMode(metadata) === "background" &&
    resolveBackgroundJobId(metadata) !== undefined
  );
};

const omitEndedTiming = (
  timing: ReturnType<typeof extractPartTiming>,
): ReturnType<typeof extractPartTiming> =>
  typeof timing.startedAtMs === "number" ? { startedAtMs: timing.startedAtMs } : {};

type OptionalUnknownRecord = Record<string, unknown> | undefined;

const resolveSubagentExternalSessionId = (
  ...sources: OptionalUnknownRecord[]
): string | undefined => {
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
  metadata?: JsonObject;
  startedAtMs?: number;
  endedAtMs?: number;
}): SubagentStreamPart => {
  const correlationKey = resolveSubagentCorrelationKey({
    messageId: input.messageId,
    partId: input.partId,
    ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : undefined),
    ...(input.agent ? { agent: input.agent } : undefined),
    ...(input.prompt ? { prompt: input.prompt } : undefined),
  });

  return {
    kind: "subagent",
    messageId: input.messageId,
    partId: input.partId,
    correlationKey,
    status: input.status,
    ...(input.agent ? { agent: input.agent } : undefined),
    ...(input.prompt ? { prompt: input.prompt } : undefined),
    ...(input.description ? { description: input.description } : undefined),
    ...(input.error ? { error: input.error } : undefined),
    ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : undefined),
    ...(input.executionMode ? { executionMode: input.executionMode } : undefined),
    ...(input.metadata ? { metadata: input.metadata } : undefined),
    ...(typeof input.startedAtMs === "number" ? { startedAtMs: input.startedAtMs } : undefined),
    ...(typeof input.endedAtMs === "number" ? { endedAtMs: input.endedAtMs } : undefined),
  };
};

const resolveSubagentAgent = (...sources: OptionalUnknownRecord[]): string | undefined => {
  for (const source of sources) {
    const agent = readTrimmedString(source, ["agent", "name", "subagent_type", "subagentType"]);
    if (agent) {
      return agent;
    }
  }

  return undefined;
};

const resolveSubagentPrompt = (...sources: OptionalUnknownRecord[]): string | undefined => {
  for (const source of sources) {
    const prompt = readTrimmedString(source, ["prompt", "message"]);
    if (prompt) {
      return prompt;
    }
  }

  return undefined;
};

const resolveSubagentDescription = (...sources: OptionalUnknownRecord[]): string | undefined => {
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
  toolState: ToolPart["state"],
  normalizedStatus: SubagentStreamPart["status"],
  timing: ReturnType<typeof extractPartTiming>,
  metadata: JsonObject | undefined,
  structuredError: string | undefined,
): SubagentStreamPart => {
  const rawInput = toolState.input;
  const rawOutput = toolState.status === "completed" ? toolState.output : undefined;
  const input = rawInput;
  const output = parseStructuredTextObject(rawOutput);
  const outputIdentity = asUnknownRecord(output?.metadata) ?? output;
  const externalSessionId = resolveSubagentExternalSessionId(metadata, input, outputIdentity);
  const agent = resolveSubagentAgent(input, metadata, output);
  const prompt = resolveSubagentPrompt(input, metadata, output);
  const directError = toolState.status === "error" ? toDisplayText(toolState.error) : undefined;
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
    ...(metadata ? { metadata } : undefined),
  });
  const description =
    resolveSubagentDescription(input, output, metadata) ?? (error ? (prompt ?? preview) : preview);

  return buildSubagentStreamPart({
    messageId: part.messageID,
    partId: part.id,
    status,
    ...(agent ? { agent } : undefined),
    ...(prompt ? { prompt } : undefined),
    ...(description ? { description } : undefined),
    ...(error ? { error } : undefined),
    ...(externalSessionId ? { externalSessionId } : undefined),
    executionMode: resolveSubagentExecutionMode(metadata, input, output),
    ...(metadata ? { metadata } : undefined),
    ...mappedTiming,
  });
};

const buildToolStreamPart = (
  part: ToolPart,
  toolState: ToolPart["state"],
  status: ToolStreamPart["status"],
  timing: ReturnType<typeof extractPartTiming>,
  metadata: JsonObject | undefined,
): ToolStreamPart => {
  const toolType = deriveToolType(part.tool);
  const input = normalizeJsonObject(toolState.input);
  const rawOutput = toolState.status === "completed" ? toolState.output : undefined;
  const fileEditPayload =
    toolType === "file_edit" ? readToolMetadataFileEditPayload(metadata, toolState, part.tool) : {};
  const preview = deriveToolPreview({
    tool: part.tool,
    rawInput: toolState.input,
    ...(metadata ? { metadata } : undefined),
  });
  const base: ToolStreamPart = {
    kind: "tool",
    messageId: part.messageID,
    partId: part.id,
    callId: part.callID,
    tool: part.tool,
    toolType,
    status,
    ...(input ? { input } : undefined),
    ...(preview ? { preview } : undefined),
    ...(metadata ? { metadata } : undefined),
    ...fileEditPayload,
    ...timing,
  };

  if (status === "pending") {
    return base;
  }
  if (status === "running") {
    const title = "title" in toolState ? toDisplayText(toolState.title) : undefined;
    return {
      ...base,
      ...(title ? { title } : undefined),
    };
  }

  const error = toolState.status === "error" ? toDisplayText(toolState.error) : undefined;
  const outputValue = rawOutput;
  const structuredError = readStructuredToolError(outputValue) ?? readStructuredToolError(metadata);
  if (status === "error") {
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

  const title = "title" in toolState ? toDisplayText(toolState.title) : undefined;
  const titleField = title ? { title } : {};
  return {
    ...base,
    ...(output ? { output } : undefined),
    ...titleField,
  };
};

export const mapPartToAgentStreamPart = (payload: unknown): AgentStreamPart | null => {
  const part = opencodePartPayloadSchema.parse(payload);

  switch (part.type) {
    case "text":
      return {
        kind: "text",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        ...(part.synthetic !== undefined ? { synthetic: part.synthetic } : undefined),
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
      const toolState = part.state;
      const timing = extractPartTiming(toolState);
      const metadata = "metadata" in toolState ? normalizeMetadata(toolState.metadata) : undefined;
      if (resolveOpencodeToolStrategy(part.tool).streamPartKind === "subagent") {
        const rawOutput = toolState.status === "completed" ? toolState.output : undefined;
        const structuredError =
          readStructuredToolError(rawOutput) ?? readStructuredToolError(metadata);
        const status = structuredError === undefined ? toolState.status : "error";
        return buildSubagentFromToolPart(
          part,
          toolState,
          status,
          timing,
          metadata,
          structuredError,
        );
      }

      return buildToolStreamPart(part, toolState, toolState.status, timing, metadata);
    }
    case "step-start":
      return {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "start",
      };
    case "step-finish": {
      const totalTokens = toTokenTotal(part.tokens);
      return {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "finish",
        reason: part.reason,
        cost: part.cost,
        ...(typeof totalTokens === "number" ? { totalTokens } : undefined),
      };
    }
    case "subtask": {
      const subtaskMetadata = normalizeMetadata({
        ...(part.model ? { model: part.model } : undefined),
        ...(part.command ? { command: part.command } : undefined),
      });

      return buildSubagentStreamPart({
        messageId: part.messageID,
        partId: part.id,
        status: "running",
        agent: part.agent,
        prompt: part.prompt,
        description: part.description,
        ...(subtaskMetadata ? { metadata: subtaskMetadata } : undefined),
      });
    }
    case "file":
    case "snapshot":
    case "patch":
    case "agent":
    case "retry":
    case "compaction":
      return null;
  }
};
