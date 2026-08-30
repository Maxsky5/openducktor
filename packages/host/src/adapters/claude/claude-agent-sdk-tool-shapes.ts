import type { SDKMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@openducktor/contracts";
import type { AgentStreamPart } from "@openducktor/core";
import { z } from "zod";
import {
  type ClaudeContentBlockIngress,
  parseClaudeCanonicalJsonObject,
} from "./claude-agent-sdk-ingress-schemas";
import type { ClaudeToolInput } from "./claude-agent-sdk-types";
import { previewInput, readStringProp, toolPartPresentation } from "./claude-agent-sdk-utils";

type ClaudeToolUseMetadata =
  | {
      blockType: ClaudeToolUseBlockType;
      serverName?: string;
    }
  | {
      durationMs: number;
      elapsedTimeSeconds: number;
    };

export type ClaudeDecodedToolUse = {
  blockType: string;
  callId: string;
  input?: ClaudeToolInput;
  metadata?: ClaudeToolUseMetadata;
  toolName: string;
};

export type ClaudeDecodedToolResult = {
  isError: boolean;
  raw: JsonObject;
  text: string;
  toolName?: string;
  toolUseId: string;
};

type ClaudeToolUseBlockType = "tool_use" | "mcp_tool_use" | "server_tool_use";

const claudeToolUseFieldsSchema = z.object({
  arguments: jsonValueSchema.optional(),
  custom_tool_use_id: z.string().optional(),
  id: z.string().optional(),
  input: jsonValueSchema.optional(),
  name: z.string().optional(),
  server_name: z.string().optional(),
  tool: z.string().optional(),
  tool_input: jsonValueSchema.optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  type: z.string().optional(),
});
const claudeToolResultFieldsSchema = z.object({
  content: jsonValueSchema.optional(),
  custom_tool_use_id: z.string().optional(),
  error: z.string().optional(),
  id: z.string().optional(),
  isError: z.boolean().optional(),
  is_error: z.boolean().optional(),
  message: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  type: z.string().optional(),
});

export const isClaudeToolUseBlockType = (
  type: string | undefined,
): type is ClaudeToolUseBlockType =>
  type === "tool_use" || type === "mcp_tool_use" || type === "server_tool_use";

export const decodeClaudeToolUseBlock = ({
  block,
  fallbackMessageId,
  index,
}: {
  block:
    | ClaudeContentBlockIngress
    | Extract<SDKMessage, { type: "assistant" }>["message"]["content"][number];
  fallbackMessageId: string;
  index: number;
}): ClaudeDecodedToolUse | null => {
  const parsedRecord = jsonObjectSchema.safeParse(block);
  if (!parsedRecord.success) {
    return null;
  }
  const parsedFields = claudeToolUseFieldsSchema.safeParse(parsedRecord.data);
  if (!parsedFields.success) {
    return null;
  }
  const candidate = parsedFields.data;
  const blockType = candidate.type;
  if (!isClaudeToolUseBlockType(blockType)) {
    return null;
  }

  const callId =
    candidate.id ??
    candidate.tool_use_id ??
    candidate.custom_tool_use_id ??
    `${fallbackMessageId}:tool:${index}`;
  const toolName = candidate.name ?? candidate.tool_name ?? candidate.tool ?? "tool";
  const rawInput = candidate.input ?? candidate.tool_input ?? candidate.arguments;
  const parsedInput = jsonObjectSchema.safeParse(rawInput);
  const input = parsedInput.success ? parsedInput.data : undefined;
  const metadata: ClaudeToolUseMetadata | undefined =
    blockType === "mcp_tool_use" || blockType === "server_tool_use" ? { blockType } : undefined;
  if (metadata && candidate.server_name) {
    metadata.serverName = candidate.server_name;
  }

  const toolUse: ClaudeDecodedToolUse = {
    blockType,
    callId,
    toolName,
  };
  if (input) toolUse.input = input;
  if (metadata) toolUse.metadata = metadata;
  return toolUse;
};

export const createClaudeRunningToolPart = ({
  messageId,
  startedAtMs,
  toolUse,
}: {
  messageId: string;
  startedAtMs: number;
  toolUse: ClaudeDecodedToolUse;
}): Extract<AgentStreamPart, { kind: "tool" }> => {
  const part: Extract<AgentStreamPart, { kind: "tool" }> = {
    kind: "tool",
    messageId,
    partId: toolUse.callId,
    callId: toolUse.callId,
    tool: toolUse.toolName,
    ...toolPartPresentation(toolUse.toolName),
    status: "running",
    startedAtMs,
  };
  if (toolUse.metadata) part.metadata = toolUse.metadata;
  if (toolUse.input) {
    part.input = parseClaudeCanonicalJsonObject(toolUse.input, "claudeToolInput");
    const preview = previewInput(toolUse.input);
    if (preview) {
      part.preview = preview;
    }
  }
  return part;
};

export const createClaudePendingToolPart = ({
  messageId,
  toolUse,
}: {
  messageId: string;
  toolUse: ClaudeDecodedToolUse;
}): Extract<AgentStreamPart, { kind: "tool" }> => {
  const part: Extract<AgentStreamPart, { kind: "tool" }> = {
    kind: "tool",
    messageId,
    partId: toolUse.callId,
    callId: toolUse.callId,
    tool: toolUse.toolName,
    ...toolPartPresentation(toolUse.toolName),
    status: "pending",
  };
  if (toolUse.metadata) part.metadata = toolUse.metadata;
  return part;
};

export const timestampMs = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const stringifyToolResultContent = (value: JsonValue): string => {
  if (value === null) {
    return "";
  }
  const primitive = z.union([z.number(), z.boolean()]).safeParse(value);
  if (primitive.success) {
    return String(primitive.data);
  }
  return JSON.stringify(value, null, 2);
};

const toolResultBlockText = (block: JsonValue): string => {
  const text = z.string().safeParse(block);
  if (text.success) {
    return text.data;
  }
  const record = jsonObjectSchema.safeParse(block);
  if (!record.success) {
    return stringifyToolResultContent(block);
  }
  return (
    readStringProp(record.data, "text") ??
    readStringProp(record.data, "message") ??
    stringifyToolResultContent(record.data)
  );
};

const claudeToolResultContentText = (value: JsonObject): string => {
  const text =
    readStringProp(value, "content") ??
    readStringProp(value, "text") ??
    readStringProp(value, "message") ??
    readStringProp(value, "error");
  if (text) {
    return text;
  }
  const content = value.content;
  const parsedContent = jsonValueSchema.safeParse(content);
  if (parsedContent.success && Array.isArray(parsedContent.data)) {
    return parsedContent.data
      .map(toolResultBlockText)
      .filter((entry) => entry.length > 0)
      .join("\n");
  }
  if (parsedContent.success && parsedContent.data !== null) {
    return stringifyToolResultContent(parsedContent.data);
  }
  return "";
};

export const decodeClaudeToolResultValue = (
  value: SessionStoreEntry[string],
  fallbackToolUseId: string | null,
  options: { allowNonToolResultType?: boolean } = {},
): ClaudeDecodedToolResult | null => {
  const parsedRecord = jsonObjectSchema.safeParse(value);
  if (!parsedRecord.success) {
    return null;
  }
  const parsedFields = claudeToolResultFieldsSchema.safeParse(parsedRecord.data);
  if (!parsedFields.success) {
    return null;
  }
  const record = parsedRecord.data;
  const fields = parsedFields.data;
  const type = fields.type;
  if (
    type &&
    type !== "tool_result" &&
    type !== "mcp_tool_result" &&
    options.allowNonToolResultType !== true
  ) {
    return null;
  }
  const toolUseId =
    readStringProp(record, "tool_use_id") ??
    readStringProp(record, "custom_tool_use_id") ??
    readStringProp(record, "id") ??
    fallbackToolUseId;
  if (!toolUseId) {
    return null;
  }
  const isErrorValue = fields.is_error ?? fields.isError;
  const toolName = fields.tool_name ?? fields.name;
  const result: ClaudeDecodedToolResult = {
    toolUseId,
    isError: isErrorValue === true,
    raw: record,
    text: claudeToolResultContentText(record),
  };
  if (toolName) result.toolName = toolName;
  return result;
};
