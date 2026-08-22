import {
  type FileContent,
  type FileDiff,
  type JsonValue,
  odtToolErrorPayloadSchema,
  hasRuntimeType,
} from "@openducktor/contracts";
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
import { opencodePartPayloadSchema, type ParsedOpencodePart } from "./opencode-ingress";

const toDisplayText = (value: JsonValue | undefined): string | undefined => {
  if (hasRuntimeType(value, "string")) {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (hasRuntimeType(value, "number") || hasRuntimeType(value, "boolean")) {
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

const parseStructuredTextObject = (
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined => {
  if (!hasRuntimeType(value, "string")) {
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

const outputTextFromMcpPayload = (value: JsonValue | undefined): string | undefined => {
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
      return hasRuntimeType(text, "string") ? text.trim() : null;
    })
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (textChunks.length === 0) {
    return undefined;
  }
  return textChunks.join("\n");
};

const readToolOutputText = (value: JsonValue | undefined): string | undefined => {
  return outputTextFromMcpPayload(value) ?? toDisplayText(value);
};

const MCP_TRANSPORT_ERROR_PREFIX = /^MCP error\s+-?\d+:/i;

const readErrorValueMessage = (value: JsonValue | undefined): string | undefined => {
  if (hasRuntimeType(value, "string")) {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  return readTrimmedString(record, ["message"]);
};

const readEnvelopeErrorMessage = (value: JsonValue | undefined): string | undefined => {
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

const readMcpTransportError = (value: JsonValue | undefined): string | undefined => {
  if (!hasRuntimeType(value, "string")) {
    return undefined;
  }

  const trimmed = value.trim();
  return MCP_TRANSPORT_ERROR_PREFIX.test(trimmed) ? trimmed : undefined;
};

const readMcpContentTextError = (value: JsonValue | undefined): string | undefined => {
  const text = outputTextFromMcpPayload(value);
  if (!text) {
    return undefined;
  }

  return readEnvelopeErrorMessage(text) ?? readMcpTransportError(text);
};

const readStructuredToolError = (value: JsonValue | undefined): string | undefined => {
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

const normalizeMetadata = (value: JsonValue | undefined): Record<string, JsonValue> | undefined => {
  const normalized = asUnknownRecord(value);
  if (!normalized) {
    return undefined;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeFileDiffType = (value: JsonValue | undefined): FileDiff["type"] => {
  if (!hasRuntimeType(value, "string")) {
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

const readFileDiffPatch = (value: Record<string, JsonValue>): string | null => {
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

const fileDiffFromToolFileDiffMetadata = (
  value: JsonValue | undefined,
  input: JsonValue | undefined,
): FileDiff | null => {
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
      hasRuntimeType(oldString, "string") && oldString.length === 0
        ? "added"
        : normalizeFileDiffType(readUnknownProp(record, "status")),
    patch: readFileDiffPatch(record),
    additions: readNumberProp(record, ["additions"]),
    deletions: readNumberProp(record, ["deletions"]),
  });
};

const fileDiffFromWriteMetadata = (
  metadata: Record<string, JsonValue>,
  input: JsonValue | undefined,
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
  metadata: Record<string, JsonValue>,
  input: JsonValue | undefined,
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
  metadata: Record<string, JsonValue> | undefined,
  toolState: Record<string, JsonValue>,
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

const extractPartTiming = (part: ParsedOpencodePart, toolState: Record<string, JsonValue>) => {
  const directTime = readRecordProp(part, "time");
  const fromDirectStart = readNumberProp(directTime, ["start"]);
  const fromDirectEnd = readNumberProp(directTime, ["end"]);

  const stateTime = readRecordProp(toolState, "time");
  const fromStateStart = readNumberProp(stateTime, ["start"]);
  const fromStateEnd = readNumberProp(stateTime, ["end"]);

  const startedAtMs = fromDirectStart ?? fromStateStart;
  const endedAtMs = fromDirectEnd ?? fromStateEnd;

  return {
    ...(() => {
      if (hasRuntimeType(startedAtMs, "number")) {
        return { startedAtMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(endedAtMs, "number")) {
        return { endedAtMs };
      }
      return {};
    })(),
  } satisfies {
    startedAtMs?: number;
    endedAtMs?: number;
  };
};

type ToolPart = Extract<ParsedOpencodePart, { type: "tool" }>;
type ToolStreamPart = Extract<AgentStreamPart, { kind: "tool" }>;
type SubagentStreamPart = Extract<AgentStreamPart, { kind: "subagent" }>;
type ToolStatus = ToolStreamPart["status"];

const readTrimmedString = (source: JsonValue | undefined, keys: string[]): string | undefined => {
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

const normalizeSubagentExecutionMode = (
  value: JsonValue | undefined,
): SubagentStreamPart["executionMode"] => {
  if (hasRuntimeType(value, "string")) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "background" || normalized === "foreground") {
      return normalized;
    }
  }

  if (hasRuntimeType(value, "boolean")) {
    return value ? "background" : "foreground";
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
  metadata: Record<string, JsonValue> | undefined,
): string | undefined => readTrimmedString(metadata, ["jobId", "jobID", "job_id"]);

const isRunningBackgroundSubagentResult = (
  metadata: Record<string, JsonValue> | undefined,
): boolean => {
  // OpenCode keeps the parent tool part carrying background job metadata; the synthetic task result is the terminal child update.
  return (
    resolveSubagentExecutionMode(metadata) === "background" &&
    resolveBackgroundJobId(metadata) !== undefined
  );
};

const omitEndedTiming = (
  timing: ReturnType<typeof extractPartTiming>,
): ReturnType<typeof extractPartTiming> =>
  hasRuntimeType(timing.startedAtMs, "number") ? { startedAtMs: timing.startedAtMs } : {};

const resolveSubagentExternalSessionId = (
  ...sources: (JsonValue | undefined)[]
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
  metadata?: Record<string, JsonValue>;
  startedAtMs?: number;
  endedAtMs?: number;
}): SubagentStreamPart => {
  const correlationKey = resolveSubagentCorrelationKey({
    messageId: input.messageId,
    partId: input.partId,
    ...(() => {
      if (input.externalSessionId) {
        return { externalSessionId: input.externalSessionId };
      }
      return {};
    })(),
    ...(() => {
      if (input.agent) {
        return { agent: input.agent };
      }
      return {};
    })(),
    ...(() => {
      if (input.prompt) {
        return { prompt: input.prompt };
      }
      return {};
    })(),
  });

  return {
    kind: "subagent",
    messageId: input.messageId,
    partId: input.partId,
    correlationKey,
    status: input.status,
    ...(() => {
      if (input.agent) {
        return { agent: input.agent };
      }
      return {};
    })(),
    ...(() => {
      if (input.prompt) {
        return { prompt: input.prompt };
      }
      return {};
    })(),
    ...(() => {
      if (input.description) {
        return { description: input.description };
      }
      return {};
    })(),
    ...(() => {
      if (input.error) {
        return { error: input.error };
      }
      return {};
    })(),
    ...(() => {
      if (input.externalSessionId) {
        return { externalSessionId: input.externalSessionId };
      }
      return {};
    })(),
    ...(() => {
      if (input.executionMode) {
        return { executionMode: input.executionMode };
      }
      return {};
    })(),
    ...(() => {
      if (input.metadata) {
        return { metadata: input.metadata };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(input.startedAtMs, "number")) {
        return { startedAtMs: input.startedAtMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(input.endedAtMs, "number")) {
        return { endedAtMs: input.endedAtMs };
      }
      return {};
    })(),
  };
};

const resolveSubagentAgent = (...sources: (JsonValue | undefined)[]): string | undefined => {
  for (const source of sources) {
    const agent = readTrimmedString(source, ["agent", "name", "subagent_type", "subagentType"]);
    if (agent) {
      return agent;
    }
  }

  return undefined;
};

const resolveSubagentPrompt = (...sources: (JsonValue | undefined)[]): string | undefined => {
  for (const source of sources) {
    const prompt = readTrimmedString(source, ["prompt", "message"]);
    if (prompt) {
      return prompt;
    }
  }

  return undefined;
};

const resolveSubagentDescription = (...sources: (JsonValue | undefined)[]): string | undefined => {
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
  toolState: Record<string, JsonValue>,
  normalizedStatus: SubagentStreamPart["status"],
  timing: ReturnType<typeof extractPartTiming>,
  metadata: Record<string, JsonValue> | undefined,
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
    ...(() => {
      if (metadata) {
        return { metadata };
      }
      return {};
    })(),
  });
  const description =
    resolveSubagentDescription(input, output, metadata) ?? (error ? (prompt ?? preview) : preview);

  return buildSubagentStreamPart({
    messageId: part.messageID,
    partId: part.id,
    status,
    ...(() => {
      if (agent) {
        return { agent };
      }
      return {};
    })(),
    ...(() => {
      if (prompt) {
        return { prompt };
      }
      return {};
    })(),
    ...(() => {
      if (description) {
        return { description };
      }
      return {};
    })(),
    ...(() => {
      if (error) {
        return { error };
      }
      return {};
    })(),
    ...(() => {
      if (externalSessionId) {
        return { externalSessionId };
      }
      return {};
    })(),
    executionMode: resolveSubagentExecutionMode(metadata, input, output),
    ...(() => {
      if (metadata) {
        return { metadata };
      }
      return {};
    })(),
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
  toolState: Record<string, JsonValue>,
  normalizedStatus: ToolStatus,
  timing: ReturnType<typeof extractPartTiming>,
  metadata: Record<string, JsonValue> | undefined,
): ToolStreamPart => {
  const toolType = deriveToolType(part.tool);
  const input = asUnknownRecord(readUnknownProp(toolState, "input"));
  const fileEditPayload =
    toolType === "file_edit" ? readToolMetadataFileEditPayload(metadata, toolState, part.tool) : {};
  const preview = deriveToolPreview({
    tool: part.tool,
    rawInput: readUnknownProp(toolState, "input"),
    rawOutput: readUnknownProp(toolState, "output"),
    ...(() => {
      if (metadata) {
        return { metadata };
      }
      return {};
    })(),
  });
  const base: ToolStreamPart = {
    kind: "tool",
    messageId: part.messageID,
    partId: part.id,
    callId: part.callID,
    tool: part.tool,
    toolType,
    status: normalizedStatus,
    ...(() => {
      if (input) {
        return { input };
      }
      return {};
    })(),
    ...(() => {
      if (preview) {
        return { preview };
      }
      return {};
    })(),
    ...(() => {
      if (metadata) {
        return { metadata };
      }
      return {};
    })(),
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
      ...(() => {
        if (title) {
          return { title };
        }
        return {};
      })(),
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
    ...(() => {
      if (output) {
        return { output };
      }
      return {};
    })(),
    ...titleField,
  };
};

export const mapPartToAgentStreamPart = (payload: JsonValue): AgentStreamPart | null => {
  const part = opencodePartPayloadSchema.parse(payload);

  switch (part.type) {
    case "text":
      return {
        kind: "text",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        ...(() => {
          if (part.synthetic !== undefined) {
            return { synthetic: part.synthetic };
          }
          return {};
        })(),
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
      const timing = extractPartTiming(part, toolState);
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
            hasRuntimeType(timing.endedAtMs, "number"),
            structuredError !== undefined,
          ),
          timing,
          metadata,
          structuredError,
        );
      }

      const normalizedStatus = normalizeToolStatus(
        readStringProp(toolState, ["status"]) ?? "",
        hasRuntimeType(timing.endedAtMs, "number"),
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
        ...(() => {
          if (hasRuntimeType(totalTokens, "number")) {
            return { totalTokens };
          }
          return {};
        })(),
      };
    }
    case "subtask": {
      const subtaskMetadata = normalizeMetadata({
        ...(() => {
          if (part.model) {
            return { model: part.model };
          }
          return {};
        })(),
        ...(() => {
          if (part.command) {
            return { command: part.command };
          }
          return {};
        })(),
      });

      return buildSubagentStreamPart({
        messageId: part.messageID,
        partId: part.id,
        status: "running",
        agent: part.agent,
        prompt: part.prompt,
        description: part.description,
        ...(() => {
          if (subtaskMetadata) {
            return { metadata: subtaskMetadata };
          }
          return {};
        })(),
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
