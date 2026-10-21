import { Buffer } from "node:buffer";
import type { ClaudeProtocolObject, ClaudeProtocolValue } from "./claude-agent-sdk-ingress-schemas";

export type ClaudeTranscriptPath = readonly (string | number)[];

export class ClaudeTranscriptDepthError extends Error {}

const CLAUDE_TRANSCRIPT_TOOL_OUTPUT_BYTES = 64 * 1024;

const graphFields = new Set([
  "type",
  "uuid",
  "parentUuid",
  "logicalParentUuid",
  "sessionId",
  "session_id",
  "timestamp",
  "isSidechain",
  "cwd",
  "relocatedCwd",
  "teamName",
  "fork_briefing",
  "sourceToolAssistantUUID",
  "agentId",
  "attachment",
]);

const rootFields = new Set([
  ...graphFields,
  "message",
  "effort",
  "perTurnEffort",
  "subtype",
  "parent_tool_use_id",
  "parent_agent_id",
  "subagent_type",
  "isCompactSummary",
  "isMeta",
  "is_meta",
  "isSynthetic",
  "interruptedByShutdown",
  "promptId",
  "origin",
  "shouldQuery",
  "supersedes",
  "retracted_message_uuids",
  "toolUseResult",
  "tool_use_result",
  "error",
  "errors",
  "is_error",
  "result",
  "stop_reason",
  "terminal_reason",
  "content",
  "operation",
  "reason",
  "deliveryId",
  "commandUuid",
  "compact_metadata",
  "compactMetadata",
  "relocated",
  "task_id",
  "tool_use_id",
  "description",
  "task_type",
  "workflow_name",
  "prompt",
  "skip_transcript",
  "ambient",
  "is_backgrounded",
  "usage",
  "modelUsage",
  "last_tool_name",
  "summary",
  "patch",
  "status",
  "output_file",
  "resource_links",
  "tasks",
]);

const metadataFields = new Set([
  "type",
  "sessionId",
  "cwd",
  "relocated",
  "relocatedCwd",
  "uuid",
  "parentUuid",
]);

export const selectClaudeTranscriptMetadataPath = (path: ClaudeTranscriptPath): boolean =>
  path.length === 0 ||
  (metadataFields.has(String(path[0])) &&
    (path[0] !== "relocated" || path.length === 1 || path[1] === "relocatedCwd"));

const summaryFields = new Set([
  "type",
  "subtype",
  "uuid",
  "parentUuid",
  "sessionId",
  "isSidechain",
  "teamName",
  "agentId",
  "sourceToolAssistantUUID",
  "parent_tool_use_id",
  "parent_agent_id",
]);
const summaryMessageFields = new Set(["id", "stop_reason", "content"]);
const summaryBlockFields = new Set(["type", "id", "tool_use_id", "text"]);

export const selectClaudeTranscriptSummaryPath = (path: ClaudeTranscriptPath): boolean => {
  if (path.length === 0) return true;
  if (summaryFields.has(String(path[0]))) return path.length === 1;
  if (path[0] === "supersedes" || path[0] === "retracted_message_uuids")
    return path.length === 1 || (path.length === 2 && Number.isInteger(path[1]));
  if (path[0] === "attachment")
    return path.length === 1 || (path.length === 2 && path[1] === "type");
  if (path[0] === "compactMetadata" || path[0] === "compact_metadata") {
    if (path.length === 1) return true;
    if (path[1] === "preservedMessages")
      return (
        path.length === 2 ||
        (path[2] === "anchorUuid" && path.length === 3) ||
        (path[2] === "uuids" &&
          (path.length === 3 || (path.length === 4 && Number.isInteger(path[3]))))
      );
    return (
      path[1] === "preservedSegment" &&
      (path.length === 2 ||
        (path.length === 3 && ["anchorUuid", "headUuid", "tailUuid"].includes(String(path[2]))))
    );
  }
  if (path[0] !== "message") return false;
  if (path.length === 1) return true;
  if (!summaryMessageFields.has(String(path[1]))) return false;
  if (path.length === 2) return true;
  if (path[1] !== "content" || !Number.isInteger(path[2])) return false;
  return path.length === 3 || (path.length === 4 && summaryBlockFields.has(String(path[3])));
};

export const isClaudeTranscriptSummaryTextPath = (path: ClaudeTranscriptPath): boolean =>
  path[0] === "message" &&
  path[1] === "content" &&
  (path.length === 2 || (path.length === 4 && Number.isInteger(path[2]) && path[3] === "text"));

const messageFields = new Set(["content", "id", "model", "role", "stop_reason"]);
const attachmentFields = new Set([
  "type",
  "prompt",
  "source_uuid",
  "delivery_id",
  "isMeta",
  "forwardedIntent",
  "commandMode",
  "origin",
  "runId",
]);
const systemSubtypes = new Set([
  "task_started",
  "task_progress",
  "task_updated",
  "task_notification",
  "background_tasks_changed",
  "compact_boundary",
  "local_command",
  "local_command_output",
  "model_refusal_fallback",
]);

const inputFields = new Set(["input", "tool_input", "arguments"]);
const outputTextFields = new Set(["text", "message", "error", "stdout", "stderr"]);
const isMessageBlock = (path: ClaudeTranscriptPath): boolean =>
  path[0] === "message" && path[1] === "content" && Number.isInteger(path[2]);

const selectContentBlockPath = (path: ClaudeTranscriptPath): boolean => {
  let blockEnd = 3;
  while (path[blockEnd] === "content" && Number.isInteger(path[blockEnd + 1])) blockEnd += 2;
  if (path.length === blockEnd + 1 && (path[blockEnd] === "signature" || path[blockEnd] === "data"))
    return false;
  if (path[blockEnd] === "source")
    return path.length === blockEnd + 1 || path[blockEnd + 1] === "media_type";
  return true;
};

export const selectClaudeTranscriptPath = (path: ClaudeTranscriptPath): boolean => {
  if (path.length === 0) return true;
  if (!rootFields.has(String(path[0]))) return false;
  if (path[0] === "origin") return path.length === 1 || path[1] === "kind";
  if (path[0] === "relocated") return path.length === 1 || path[1] === "relocatedCwd";
  if (path[0] === "attachment") {
    if (path.length === 1) return true;
    if (!attachmentFields.has(String(path[1]))) return false;
    return path[1] !== "prompt" || !Number.isInteger(path[2]) || selectContentBlockPath(path);
  }
  if (path[0] === "toolUseResult" || path[0] === "tool_use_result") {
    if (path.at(-1) === "base64" && path.at(-2) === "file") return false;
    if (path.at(-1) === "data" && path.at(-2) === "source") return false;
  }
  if (path[0] !== "message") return true;
  if (path.length === 1) return true;
  if (!messageFields.has(String(path[1]))) return false;
  if (!isMessageBlock(path) || path.length === 3) return true;
  return selectContentBlockPath(path);
};

export const claudeTranscriptStringLimit = (
  path: ClaudeTranscriptPath,
  parent: Readonly<ClaudeProtocolObject> | undefined,
): number | undefined => {
  const toolRoot = path[0] === "toolUseResult" || path[0] === "tool_use_result";
  const block = isMessageBlock(path);
  if (!toolRoot && !block) return undefined;
  if (block && inputFields.has(String(path[3]))) return undefined;
  if (block && path.length === 4 && (path[3] === "text" || path[3] === "thinking")) {
    if (parent?.type !== "tool_result" && parent?.type !== "mcp_tool_result") return undefined;
  }
  const field = path.at(-1);
  if (field === undefined || Number.isInteger(field)) {
    return field !== undefined && path.at(-2) === "content"
      ? CLAUDE_TRANSCRIPT_TOOL_OUTPUT_BYTES
      : undefined;
  }
  if (outputTextFields.has(String(field))) return CLAUDE_TRANSCRIPT_TOOL_OUTPUT_BYTES;
  if (field !== "content") return undefined;
  if (parent?.type === "create" || parent?.type === "update") return undefined;
  if (toolRoot && path.at(-2) === "file") return CLAUDE_TRANSCRIPT_TOOL_OUTPUT_BYTES;
  // The structured top-level result can contain Write content before its type.
  if (
    toolRoot &&
    path.length === 2 &&
    parent?.type !== "tool_result" &&
    parent?.type !== "mcp_tool_result"
  )
    return undefined;
  return CLAUDE_TRANSCRIPT_TOOL_OUTPUT_BYTES;
};

export const retainClaudeTranscriptRecord = (
  record: ClaudeProtocolObject,
): ClaudeProtocolObject | null => {
  if (
    record.type === "user" ||
    record.type === "assistant" ||
    record.type === "result" ||
    (record.type === "system" && systemSubtypes.has(String(record.subtype))) ||
    (record.type === "queue-operation" && record.operation === "enqueue")
  ) {
    return record;
  }
  const retained: ClaudeProtocolObject = {};
  for (const field of [
    ...graphFields,
    "subtype",
    "isMeta",
    "supersedes",
    "retracted_message_uuids",
    "compactMetadata",
    "compact_metadata",
  ]) {
    if (Object.hasOwn(record, field)) retained[field] = record[field]!;
  }
  if (record.type === "queue-operation") {
    for (const field of ["operation", "reason", "deliveryId", "commandUuid"]) {
      if (Object.hasOwn(record, field)) retained[field] = record[field]!;
    }
  }
  if (record.relocated !== undefined) retained.relocated = record.relocated;
  return Object.hasOwn(record, "uuid") ||
    Object.hasOwn(record, "parentUuid") ||
    Object.hasOwn(record, "supersedes") ||
    Object.hasOwn(record, "retracted_message_uuids") ||
    Object.hasOwn(record, "relocated") ||
    Object.hasOwn(record, "relocatedCwd") ||
    record.type === "queue-operation"
    ? retained
    : null;
};

export const retainParsedClaudeTranscriptRecord = (
  record: ClaudeProtocolObject,
  options: { metadataOnly?: boolean; summaryOnly?: boolean } = {},
): ClaudeProtocolObject | null => {
  const select = options.metadataOnly
    ? selectClaudeTranscriptMetadataPath
    : options.summaryOnly
      ? selectClaudeTranscriptSummaryPath
      : selectClaudeTranscriptPath;
  const checkDepth = (value: ClaudeProtocolValue, depth: number): void => {
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- JSON.parse already validates this JSON value.
    if (value === null || typeof value !== "object") return;
    if (depth >= 256) throw new ClaudeTranscriptDepthError();
    if (Array.isArray(value)) {
      for (const child of value) checkDepth(child, depth + 1);
    } else {
      for (const key of Object.keys(value)) checkDepth(value[key]!, depth + 1);
    }
  };
  const retain = (
    value: ClaudeProtocolValue,
    path: ClaudeTranscriptPath,
    parent: ClaudeProtocolObject | undefined,
  ): ClaudeProtocolValue | undefined => {
    if (!select(path)) {
      checkDepth(value, path.length);
      return undefined;
    }
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- JSON.parse already validates this JSON value.
    if (typeof value === "string") {
      if (options.summaryOnly && isClaudeTranscriptSummaryTextPath(path))
        return value.trim().length > 0 ? "x" : "";
      const limit = claudeTranscriptStringLimit(path, parent);
      if (limit === undefined) return value;
      const bytes = Buffer.byteLength(value);
      if (bytes <= limit) return value;
      const marker = `\n[Claude tool output truncated; original size: ${bytes} UTF-8 bytes]`;
      const buffer = Buffer.from(value.slice(0, limit));
      let end = Math.max(0, limit - Buffer.byteLength(marker));
      while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
      return buffer.toString("utf8", 0, end) + marker;
    }
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- The value already has the validated JSON union type.
    if (value === null || typeof value !== "object") return value;
    if (path.length >= 256) throw new ClaudeTranscriptDepthError();
    if (Array.isArray(value)) {
      const retained: ClaudeProtocolValue[] = [];
      for (let index = 0; index < value.length; index++) {
        const child = retain(value[index]!, [...path, index], undefined);
        if (child !== undefined) retained.push(child);
      }
      return retained;
    }
    const retained: ClaudeProtocolObject = {};
    for (const key of Object.keys(value)) {
      const child = retain(value[key]!, [...path, key], value);
      if (child !== undefined)
        Object.defineProperty(retained, key, {
          value: child,
          configurable: true,
          enumerable: true,
          writable: true,
        });
    }
    return retained;
  };
  // SAFETY: The selected root is an object, and retention preserves its container kind.
  const retained = retain(record, [], undefined) as ClaudeProtocolObject;
  return options.metadataOnly || options.summaryOnly
    ? retained
    : retainClaudeTranscriptRecord(retained);
};
