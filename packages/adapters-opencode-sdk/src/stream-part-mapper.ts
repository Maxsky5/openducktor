import type { Part } from "@opencode-ai/sdk/v2/client";
import type { AgentStreamPart } from "@openducktor/core";
import {
  asUnknownRecord,
  readBooleanProp,
  readNumberProp,
  readRecordProp,
  readStringProp,
  readUnknownProp,
} from "./guards";
import { toTokenTotal } from "./message-normalizers";
import { deriveToolPreview } from "./tool-preview";

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

const readStructuredToolError = (value: unknown): string | undefined => {
  const record = asUnknownRecord(value) ?? parseStructuredTextObject(value);
  if (!record) {
    return undefined;
  }

  const isError = readUnknownProp(record, "isError");
  const directError = readUnknownProp(record, "error");
  const directErrorMessage = readUnknownProp(directError, "message");
  const structuredContent = readUnknownProp(record, "structuredContent");
  const structuredError = readUnknownProp(structuredContent, "error");
  const structuredErrorMessage = readUnknownProp(structuredError, "message");
  const structuredOk = readUnknownProp(structuredContent, "ok");

  if (typeof directErrorMessage === "string" && directErrorMessage.trim().length > 0) {
    return directErrorMessage.trim();
  }
  if (typeof structuredErrorMessage === "string" && structuredErrorMessage.trim().length > 0) {
    return structuredErrorMessage.trim();
  }
  if (isError === true || structuredOk === false) {
    return outputTextFromMcpPayload(value) ?? toDisplayText(value) ?? "Tool failed";
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

const SUBAGENT_TOOL_NAMES = new Set(["task", "delegate", "subtask"]);

const normalizeToolName = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("functions.") ? trimmed.slice("functions.".length) : trimmed;
};

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

const resolveSubagentSessionId = (...sources: unknown[]): string | undefined => {
  for (const source of sources) {
    const sessionId = readTrimmedString(source, ["sessionId", "sessionID", "session_id"]);
    if (sessionId) {
      return sessionId;
    }
  }

  return undefined;
};

const resolveSubagentCorrelationKey = (input: {
  messageId: string;
  partId: string;
  sessionId?: string;
  agent?: string;
  prompt?: string;
}): string => {
  const agent = input.agent?.trim() ?? "";
  const prompt = input.prompt?.trim() ?? "";

  if (agent || prompt) {
    return ["spawn", input.messageId, agent, prompt].join(":");
  }

  if (input.sessionId) {
    return ["session", input.messageId, input.sessionId].join(":");
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
  sessionId?: string;
  executionMode?: SubagentStreamPart["executionMode"];
  metadata?: Record<string, unknown>;
  startedAtMs?: number;
  endedAtMs?: number;
}): SubagentStreamPart => {
  const correlationKey = resolveSubagentCorrelationKey({
    messageId: input.messageId,
    partId: input.partId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
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
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
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
): SubagentStreamPart => {
  const rawInput = readUnknownProp(toolState, "input");
  const rawOutput = readUnknownProp(toolState, "output");
  const input = asUnknownRecord(rawInput);
  const output = asUnknownRecord(rawOutput) ?? parseStructuredTextObject(rawOutput);
  const sessionId = resolveSubagentSessionId(metadata, input, output);
  const agent = resolveSubagentAgent(input, metadata, output);
  const prompt = resolveSubagentPrompt(input, metadata, output);
  const description =
    resolveSubagentDescription(input, output, metadata) ??
    deriveToolPreview({
      tool: part.tool,
      rawInput,
      rawOutput,
      ...(metadata ? { metadata } : {}),
    });

  return buildSubagentStreamPart({
    messageId: part.messageID,
    partId: part.id,
    status: normalizedStatus,
    ...(agent ? { agent } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(sessionId ? { sessionId } : {}),
    executionMode: resolveSubagentExecutionMode(metadata, input, output),
    ...(metadata ? { metadata } : {}),
    ...timing,
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
): SubagentStreamPart["status"] => {
  const normalized = rawStatus.trim().toLowerCase();
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
    status: normalizedStatus,
    input: part.state.input,
    ...(preview ? { preview } : {}),
    ...(metadata ? { metadata } : {}),
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
      if (SUBAGENT_TOOL_NAMES.has(normalizeToolName(part.tool))) {
        return buildSubagentFromToolPart(
          part,
          toolState,
          normalizeSubagentStatus(
            readStringProp(toolState, ["status"]) ?? "",
            typeof timing.endedAtMs === "number",
          ),
          timing,
          metadata,
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
