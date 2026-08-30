import {
  type FileContent,
  type FileDiff,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  jsonObjectSchema,
  jsonValueSchema,
  odtToolErrorPayloadSchema,
} from "@openducktor/contracts";
import {
  type AgentStreamPart,
  countRenderableFileDiffLines,
  selectRenderableFileDiff,
} from "@openducktor/core";
import { asJsonObject, readBooleanProp, readNumberProp, readStringProp } from "./guards";
import { toTokenTotal } from "./message-normalizers";
import { deriveToolPreview, deriveToolType } from "./tool-preview";
import { resolveOpencodeToolStrategy } from "./tool-strategy-catalog";
import type { ParsedOpencodePart } from "./opencode-ingress";
import { z } from "zod";

const toDisplayText = (value: JsonValue | undefined): string | undefined => {
  const stringValue = z.string().safeParse(value);
  if (stringValue.success) {
    const trimmed = stringValue.data.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  const scalarValue = z.union([z.number(), z.boolean()]).safeParse(value);
  if (scalarValue.success) {
    return String(scalarValue.data);
  }
  if (Array.isArray(value) && value.length === 0) {
    return undefined;
  }
  const valueRecord = asJsonObject(value);
  if (valueRecord && Object.keys(valueRecord).length === 0) {
    return undefined;
  }
  return JSON.stringify(value, null, 2);
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
      const entryRecord = asJsonObject(entry);
      if (!entryRecord) {
        return null;
      }
      const text = z.string().safeParse(entryRecord.text);
      return text.success ? text.data.trim() : null;
    })
    .filter((entry): entry is string => entry !== null && entry.length > 0);
  if (textChunks.length === 0) {
    return undefined;
  }
  return textChunks.join("\n");
};

const readToolOutputText = (value: string | undefined): string | undefined => toDisplayText(value);

const MCP_TRANSPORT_ERROR_PREFIX = /^MCP error\s+-?\d+:/i;

const readErrorValueMessage = (value: JsonValue | undefined): string | undefined => {
  const stringValue = z.string().safeParse(value);
  if (stringValue.success) {
    const trimmed = stringValue.data.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  const record = asJsonObject(value);
  if (!record) {
    return undefined;
  }

  return readTrimmedString(record, ["message"]);
};

const readEnvelopeErrorMessage = (value: string | JsonObject | undefined): string | undefined => {
  const stringValue = z.string().safeParse(value);
  const objectValue = jsonObjectSchema.safeParse(value);
  const record = stringValue.success
    ? parseStructuredTextObject(stringValue.data)
    : objectValue.success
      ? objectValue.data
      : undefined;
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
  const stringValue = z.string().safeParse(value);
  const objectValue = jsonObjectSchema.safeParse(value);
  const record = stringValue.success
    ? parseStructuredTextObject(stringValue.data)
    : objectValue.success
      ? objectValue.data
      : undefined;
  const contentTextError = readMcpContentTextError(record);
  const transportError = readMcpTransportError(stringValue.success ? stringValue.data : undefined);
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

const normalizeMetadata = (value: JsonObject | undefined): JsonObject | undefined => {
  return value && Object.keys(value).length > 0 ? value : undefined;
};

const normalizeFileDiffType = (value: JsonValue | undefined): FileDiff["type"] => {
  const parsed = z.string().safeParse(value);
  if (!parsed.success) {
    return "modified";
  }
  const normalized = parsed.data.trim().toLowerCase();
  if (normalized === "add" || normalized === "added") {
    return "added";
  }
  if (normalized === "delete" || normalized === "deleted") {
    return "deleted";
  }
  return "modified";
};

const readFileDiffPatch = (value: JsonObject): string | null => {
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

const fileDiffFromToolFileMetadata = (value: JsonValue | undefined): FileDiff | null => {
  const record = asJsonObject(value);
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
  input: JsonObject,
): FileDiff | null => {
  const record = asJsonObject(value);
  if (!record) {
    return null;
  }
  const inputRecord = asJsonObject(input);
  const oldString = inputRecord?.oldString;

  return normalizeToolMetadataFileDiff({
    file:
      readStringProp(record, ["file"]) ??
      readStringProp(inputRecord, ["filePath", "file_path", "path", "file"]),
    type: oldString === "" ? "added" : normalizeFileDiffType(record.status),
    patch: readFileDiffPatch(record),
    additions: readNumberProp(record, ["additions"]),
    deletions: readNumberProp(record, ["deletions"]),
  });
};

const fileDiffFromWriteMetadata = (metadata: JsonObject, input: JsonObject): FileDiff | null => {
  const inputRecord = asJsonObject(input);
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
  input: JsonObject,
): FileContent | null => {
  const inputRecord = asJsonObject(input);
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

type PartTiming = Pick<ToolStreamPart, "startedAtMs" | "endedAtMs">;

const extractPartTiming = (toolState: ToolPart["state"]): PartTiming => {
  const startedAtMs = toolState.status === "pending" ? undefined : toolState.time.start;
  const endedAtMs =
    toolState.status === "completed" || toolState.status === "error"
      ? toolState.time.end
      : undefined;

  const timing: PartTiming = {};
  if (startedAtMs !== undefined) {
    timing.startedAtMs = startedAtMs;
  }
  if (endedAtMs !== undefined) {
    timing.endedAtMs = endedAtMs;
  }
  return timing;
};

type ToolStreamPart = Extract<AgentStreamPart, { kind: "tool" }>;
type SubagentStreamPart = Extract<AgentStreamPart, { kind: "subagent" }>;

const readTrimmedString = (source: JsonObject | undefined, keys: string[]): string | undefined => {
  const value = readStringProp(source, keys);
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeSubagentExecutionMode = (
  value: JsonValue | undefined,
): SubagentStreamPart["executionMode"] => {
  const stringValue = z.string().safeParse(value);
  if (stringValue.success) {
    const normalized = stringValue.data.trim().toLowerCase();
    if (normalized === "background" || normalized === "foreground") {
      return normalized;
    }
  }

  const booleanValue = z.boolean().safeParse(value);
  if (booleanValue.success) {
    return booleanValue.data ? "background" : "foreground";
  }

  return undefined;
};

const resolveSubagentExecutionMode = (
  ...sources: (JsonValue | undefined)[]
): SubagentStreamPart["executionMode"] => {
  for (const source of sources) {
    const direct = normalizeSubagentExecutionMode(source);
    if (direct) {
      return direct;
    }

    const record = asJsonObject(source);
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
  timing.startedAtMs !== undefined ? { startedAtMs: timing.startedAtMs } : {};

const resolveSubagentExternalSessionId = (
  ...sources: Array<JsonObject | undefined>
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
  const correlationInput: Parameters<typeof resolveSubagentCorrelationKey>[0] = {
    messageId: input.messageId,
    partId: input.partId,
  };
  if (input.externalSessionId) {
    correlationInput.externalSessionId = input.externalSessionId;
  }
  if (input.agent) {
    correlationInput.agent = input.agent;
  }
  if (input.prompt) {
    correlationInput.prompt = input.prompt;
  }
  const correlationKey = resolveSubagentCorrelationKey(correlationInput);

  const result: SubagentStreamPart = {
    kind: "subagent",
    messageId: input.messageId,
    partId: input.partId,
    correlationKey,
    status: input.status,
  };
  if (input.agent) {
    result.agent = input.agent;
  }
  if (input.prompt) {
    result.prompt = input.prompt;
  }
  if (input.description) {
    result.description = input.description;
  }
  if (input.error) {
    result.error = input.error;
  }
  if (input.externalSessionId) {
    result.externalSessionId = input.externalSessionId;
  }
  if (input.executionMode) {
    result.executionMode = input.executionMode;
  }
  if (input.metadata) {
    result.metadata = input.metadata;
  }
  if (input.startedAtMs !== undefined) {
    result.startedAtMs = input.startedAtMs;
  }
  if (input.endedAtMs !== undefined) {
    result.endedAtMs = input.endedAtMs;
  }
  return result;
};

const resolveSubagentAgent = (...sources: Array<JsonObject | undefined>): string | undefined => {
  for (const source of sources) {
    const agent = readTrimmedString(source, ["agent", "name", "subagent_type", "subagentType"]);
    if (agent) {
      return agent;
    }
  }

  return undefined;
};

const resolveSubagentPrompt = (...sources: Array<JsonObject | undefined>): string | undefined => {
  for (const source of sources) {
    const prompt = readTrimmedString(source, ["prompt", "message"]);
    if (prompt) {
      return prompt;
    }
  }

  return undefined;
};

const resolveSubagentDescription = (
  ...sources: Array<JsonObject | undefined>
): string | undefined => {
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
  const outputIdentity = asJsonObject(output?.metadata) ?? output;
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
  const previewInput: Parameters<typeof deriveToolPreview>[0] = {
    tool: part.tool,
    rawInput,
  };
  if (metadata) {
    previewInput.metadata = metadata;
  }
  const preview = deriveToolPreview(previewInput);
  const description =
    resolveSubagentDescription(input, output, metadata) ?? (error ? (prompt ?? preview) : preview);

  const subagentInput: Parameters<typeof buildSubagentStreamPart>[0] = {
    messageId: part.messageID,
    partId: part.id,
    status,
  };
  const executionMode = resolveSubagentExecutionMode(metadata, input, output);
  if (executionMode) {
    subagentInput.executionMode = executionMode;
  }
  if (mappedTiming.startedAtMs !== undefined) {
    subagentInput.startedAtMs = mappedTiming.startedAtMs;
  }
  if (mappedTiming.endedAtMs !== undefined) {
    subagentInput.endedAtMs = mappedTiming.endedAtMs;
  }
  if (agent) {
    subagentInput.agent = agent;
  }
  if (prompt) {
    subagentInput.prompt = prompt;
  }
  if (description) {
    subagentInput.description = description;
  }
  if (error) {
    subagentInput.error = error;
  }
  if (externalSessionId) {
    subagentInput.externalSessionId = externalSessionId;
  }
  if (metadata) {
    subagentInput.metadata = metadata;
  }
  return buildSubagentStreamPart(subagentInput);
};

const buildToolStreamPart = (
  part: ToolPart,
  toolState: ToolPart["state"],
  status: ToolStreamPart["status"],
  timing: ReturnType<typeof extractPartTiming>,
  metadata: JsonObject | undefined,
): ToolStreamPart => {
  const toolType = deriveToolType(part.tool);
  const input = toolState.input;
  const rawOutput = toolState.status === "completed" ? toolState.output : undefined;
  const fileEditPayload =
    toolType === "file_edit" ? readToolMetadataFileEditPayload(metadata, toolState, part.tool) : {};
  const previewInput: Parameters<typeof deriveToolPreview>[0] = {
    tool: part.tool,
    rawInput: toolState.input,
  };
  if (metadata) {
    previewInput.metadata = metadata;
  }
  const preview = deriveToolPreview(previewInput);
  const base: ToolStreamPart = {
    kind: "tool",
    messageId: part.messageID,
    partId: part.id,
    callId: part.callID,
    tool: part.tool,
    toolType,
    status,
    ...fileEditPayload,
    ...timing,
  };
  if (input) {
    base.input = input;
  }
  if (preview) {
    base.preview = preview;
  }
  if (metadata) {
    base.metadata = metadata;
  }

  if (status === "pending") {
    return base;
  }
  if (status === "running") {
    const title = "title" in toolState ? toDisplayText(toolState.title) : undefined;
    if (title) {
      base.title = title;
    }
    return base;
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
  if (output) {
    base.output = output;
  }
  if (title) {
    base.title = title;
  }
  return base;
};

export const mapPartToAgentStreamPart = (part: ParsedOpencodePart): AgentStreamPart | null => {
  switch (part.type) {
    case "text":
      const textPart: Extract<AgentStreamPart, { kind: "text" }> = {
        kind: "text",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        completed: Boolean(part.time?.end),
      };
      if (part.synthetic !== undefined) {
        textPart.synthetic = part.synthetic;
      }
      return textPart;
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
      const stepPart: Extract<AgentStreamPart, { kind: "step" }> = {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "finish",
        reason: part.reason,
        cost: part.cost,
      };
      if (totalTokens !== undefined) {
        stepPart.totalTokens = totalTokens;
      }
      return stepPart;
    }
    case "subtask": {
      const subtaskMetadataSource: JsonObject = {};
      if (part.model) {
        subtaskMetadataSource.model = part.model;
      }
      if (part.command) {
        subtaskMetadataSource.command = part.command;
      }
      const subtaskMetadata = normalizeMetadata(subtaskMetadataSource);

      const subtaskInput: Parameters<typeof buildSubagentStreamPart>[0] = {
        messageId: part.messageID,
        partId: part.id,
        status: "running",
        agent: part.agent,
        prompt: part.prompt,
        description: part.description,
      };
      if (subtaskMetadata) {
        subtaskInput.metadata = subtaskMetadata;
      }
      return buildSubagentStreamPart(subtaskInput);
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
