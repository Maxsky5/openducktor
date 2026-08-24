import { jsonValueSchema } from "@openducktor/contracts";
import type { JsonValue } from "@openducktor/contracts";
import type { AgentStreamPart } from "@openducktor/core";
import { parseClaudeCanonicalJsonObject } from "./claude-agent-sdk-ingress-schemas";
import {
  claudeUnknownRecordSchema,
  isRecord,
  previewInput,
  readStringProp,
  toolPartPresentation,
} from "./claude-agent-sdk-utils";

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
  input?: Record<string, unknown>;
  metadata?: ClaudeToolUseMetadata;
  toolName: string;
};

export type ClaudeDecodedToolResult = {
  isError: boolean;
  raw: Record<string, unknown>;
  text: string;
  toolName?: string;
  toolUseId: string;
};

type ClaudeToolUseBlockType = "tool_use" | "mcp_tool_use" | "server_tool_use";

export const isClaudeToolUseBlockType = (
  type: string | undefined,
): type is ClaudeToolUseBlockType =>
  type === "tool_use" || type === "mcp_tool_use" || type === "server_tool_use";

export const decodeClaudeToolUseBlock = ({
  block,
  fallbackMessageId,
  index,
}: {
  block: Record<string, unknown>;
  fallbackMessageId: string;
  index: number;
}): ClaudeDecodedToolUse | null => {
  const blockType = readStringProp(block, "type");
  if (!isClaudeToolUseBlockType(blockType)) {
    return null;
  }

  const callId =
    readStringProp(block, "id") ??
    readStringProp(block, "tool_use_id") ??
    readStringProp(block, "custom_tool_use_id") ??
    `${fallbackMessageId}:tool:${index}`;
  const toolName =
    readStringProp(block, "name") ??
    readStringProp(block, "tool_name") ??
    readStringProp(block, "tool") ??
    "tool";
  const rawInput = block.input ?? block.tool_input ?? block.arguments;
  const input = isRecord(rawInput) ? rawInput : undefined;
  const serverName = readStringProp(block, "server_name");
  const metadata =
    blockType === "mcp_tool_use" || blockType === "server_tool_use"
      ? {
          blockType,
          ...(serverName ? { serverName } : undefined),
        }
      : undefined;

  return {
    blockType,
    callId,
    toolName,
    ...(input ? { input } : undefined),
    ...(metadata ? { metadata } : undefined),
  };
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
    ...(toolUse.metadata ? { metadata: toolUse.metadata } : undefined),
  };
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
}): Extract<AgentStreamPart, { kind: "tool" }> => ({
  kind: "tool",
  messageId,
  partId: toolUse.callId,
  callId: toolUse.callId,
  tool: toolUse.toolName,
  ...toolPartPresentation(toolUse.toolName),
  status: "pending",
  ...(toolUse.metadata ? { metadata: toolUse.metadata } : undefined),
});

export const timestampMs = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const stringifyToolResultContent = (value: JsonValue | undefined): string => {
  if (value === undefined) {
    return "";
  }
  if (value === null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
};

const toolResultBlockText = (block: unknown): string => {
  if (block === undefined) {
    return stringifyToolResultContent(block);
  }
  const parsed = jsonValueSchema.parse(block);
  if (typeof parsed === "string") {
    return parsed;
  }
  if (!isRecord(parsed)) {
    return stringifyToolResultContent(parsed);
  }
  return (
    readStringProp(parsed, "text") ??
    readStringProp(parsed, "message") ??
    stringifyToolResultContent(parsed)
  );
};

const claudeToolResultContentText = (value: Record<string, unknown>): string => {
  const text =
    readStringProp(value, "content") ??
    readStringProp(value, "text") ??
    readStringProp(value, "message") ??
    readStringProp(value, "error");
  if (text) {
    return text;
  }
  const content = value.content;
  if (Array.isArray(content)) {
    return content
      .map(toolResultBlockText)
      .filter((entry) => entry.length > 0)
      .join("\n");
  }
  if (content !== undefined && content !== null) {
    return stringifyToolResultContent(jsonValueSchema.parse(content));
  }
  return "";
};

export const decodeClaudeToolResultValue = (
  value: unknown,
  fallbackToolUseId: string | null,
  options: { allowNonToolResultType?: boolean } = {},
): ClaudeDecodedToolResult | null => {
  const parsed = claudeUnknownRecordSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const record = parsed.data;
  const type = readStringProp(record, "type");
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
  const isErrorValue = record.is_error ?? record.isError;
  const toolName = readStringProp(record, "tool_name") ?? readStringProp(record, "name");
  return {
    toolUseId,
    ...(toolName ? { toolName } : undefined),
    isError: isErrorValue === true,
    raw: record,
    text: claudeToolResultContentText(record),
  };
};
