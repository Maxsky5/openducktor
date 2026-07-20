import type { AgentStreamPart } from "@openducktor/core";
import {
  isRecord,
  previewInput,
  readStringProp,
  toolPartPresentation,
} from "./claude-agent-sdk-utils";

export type ClaudeDecodedToolUse = {
  blockType: string;
  callId: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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
          ...(serverName ? { serverName } : {}),
        }
      : undefined;

  return {
    blockType,
    callId,
    toolName,
    ...(input ? { input } : {}),
    ...(metadata ? { metadata } : {}),
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
    ...(toolUse.metadata ? { metadata: toolUse.metadata } : {}),
  };
  if (toolUse.input) {
    part.input = toolUse.input;
    const preview = previewInput(toolUse.input);
    if (preview) {
      part.preview = preview;
    }
  }
  return part;
};

export const timestampMs = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const stringifyToolResultContent = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toolResultBlockText = (block: unknown): string => {
  if (typeof block === "string") {
    return block;
  }
  if (!isRecord(block)) {
    return stringifyToolResultContent(block);
  }
  return (
    readStringProp(block, "text") ??
    readStringProp(block, "message") ??
    stringifyToolResultContent(block)
  );
};

export const claudeToolResultContentText = (value: Record<string, unknown>): string => {
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
    return stringifyToolResultContent(content);
  }
  return "";
};

export const decodeClaudeToolResultValue = (
  value: unknown,
  fallbackToolUseId: string | null,
  options: { allowNonToolResultType?: boolean } = {},
): ClaudeDecodedToolResult | null => {
  if (!isRecord(value)) {
    return null;
  }
  const type = readStringProp(value, "type");
  if (
    type &&
    type !== "tool_result" &&
    type !== "mcp_tool_result" &&
    options.allowNonToolResultType !== true
  ) {
    return null;
  }
  const toolUseId =
    readStringProp(value, "tool_use_id") ??
    readStringProp(value, "custom_tool_use_id") ??
    readStringProp(value, "id") ??
    fallbackToolUseId;
  if (!toolUseId) {
    return null;
  }
  const isErrorValue = value.is_error ?? value.isError;
  const toolName = readStringProp(value, "tool_name") ?? readStringProp(value, "name");
  return {
    toolUseId,
    ...(toolName ? { toolName } : {}),
    isError: isErrorValue === true,
    raw: value,
    text: claudeToolResultContentText(value),
  };
};
