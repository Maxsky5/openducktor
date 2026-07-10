import { basename } from "node:path";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentFileReference,
  AgentSessionHistoryMessage,
  AgentSkillReference,
  AgentStreamPart,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import {
  createClaudeRunningToolPart,
  decodeClaudeToolResultValue,
  decodeClaudeToolUseBlock,
  timestampMs,
} from "./claude-agent-sdk-tool-shapes";
import { detectFileKind, isRecord, readStringProp } from "./claude-agent-sdk-utils";

export type ClaudeLiveUserMessage = {
  messageId: string;
  text: string;
};

type MutableAssistantHistoryMessage = Extract<AgentSessionHistoryMessage, { role: "assistant" }>;

const CLAUDE_HISTORY_ATTACHMENT_PATH_PREFIX = "claude-history://attachment/";

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const extensionForMime = (mime: string | undefined): string =>
  mime ? (MIME_EXTENSIONS[mime] ?? "") : "";

const claudeHistoryAttachmentPath = (messageId: string, index: number): string =>
  `${CLAUDE_HISTORY_ATTACHMENT_PATH_PREFIX}${encodeURIComponent(messageId)}/${index}`;

type ClaudeHistoryReferenceRange = {
  start: number;
  end: number;
  part: Extract<AgentUserMessageDisplayPart, { kind: "file_reference" | "skill_mention" }>;
};

const CLAUDE_SKILL_TOKEN_PATTERN = /\/([\p{L}\p{N}:_-]+)/gu;
const CLAUDE_FILE_TOKEN_PATTERN = /@([^\s]+)/gu;
const CLAUDE_FILE_TRAILING_PUNCTUATION_PATTERN = /[,.;!?)}\]]+$/u;
const CLAUDE_REFERENCE_BOUNDARY_PATTERN = /[\s([{"']/u;

const hasClaudeReferenceBoundary = (text: string, start: number): boolean =>
  start === 0 || CLAUDE_REFERENCE_BOUNDARY_PATTERN.test(text[start - 1] ?? "");

const claudeFileReference = (path: string): AgentFileReference => ({
  id: path,
  path,
  name: basename(path.replaceAll("\\", "/")),
  kind: detectFileKind(path, false) as AgentFileReference["kind"],
});

const readClaudeHistoryReferenceRanges = (
  text: string,
  skillsByName: ReadonlyMap<string, AgentSkillReference>,
): ClaudeHistoryReferenceRange[] => {
  const ranges: ClaudeHistoryReferenceRange[] = [];
  for (const match of text.matchAll(CLAUDE_SKILL_TOKEN_PATTERN)) {
    const start = match.index;
    const name = match[1];
    const skill = name ? skillsByName.get(name) : undefined;
    if (!skill || !hasClaudeReferenceBoundary(text, start)) {
      continue;
    }
    ranges.push({
      start,
      end: start + match[0].length,
      part: { kind: "skill_mention", skill },
    });
  }
  for (const match of text.matchAll(CLAUDE_FILE_TOKEN_PATTERN)) {
    const start = match.index;
    if (!hasClaudeReferenceBoundary(text, start)) {
      continue;
    }
    const path = match[1]?.replace(CLAUDE_FILE_TRAILING_PUNCTUATION_PATTERN, "");
    if (!path) {
      continue;
    }
    ranges.push({
      start,
      end: start + path.length + 1,
      part: { kind: "file_reference", file: claudeFileReference(path) },
    });
  }
  return ranges.sort((left, right) => left.start - right.start);
};

const readClaudeHistoryTextDisplayParts = (
  text: string,
  skillsByName: ReadonlyMap<string, AgentSkillReference>,
): AgentUserMessageDisplayPart[] => {
  const ranges = readClaudeHistoryReferenceRanges(text, skillsByName);
  if (ranges.length === 0) {
    return text.length > 0 ? [{ kind: "text", text }] : [];
  }

  const parts: AgentUserMessageDisplayPart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }
    if (range.start > cursor) {
      parts.push({ kind: "text", text: text.slice(cursor, range.start) });
    }
    parts.push(range.part);
    cursor = range.end;
  }
  if (cursor < text.length) {
    parts.push({ kind: "text", text: text.slice(cursor) });
  }
  return parts;
};

export const readClaudeHistoryDisplayParts = (
  messageId: string,
  message: unknown,
  skills: readonly AgentSkillReference[] = [],
): AgentUserMessageDisplayPart[] => {
  if (!isRecord(message)) {
    return [];
  }
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
  const content = message.content;
  if (typeof content === "string" && content.length > 0) {
    return readClaudeHistoryTextDisplayParts(content, skillsByName);
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: AgentUserMessageDisplayPart[] = [];
  for (const [index, block] of content.entries()) {
    if (!isRecord(block)) {
      continue;
    }
    const type = readStringProp(block, "type");
    if (type === "text") {
      const text = readStringProp(block, "text");
      if (text) {
        parts.push(...readClaudeHistoryTextDisplayParts(text, skillsByName));
      }
      continue;
    }
    if (type === "image") {
      const source = isRecord(block.source) ? block.source : {};
      const mime = readStringProp(source, "media_type");
      parts.push({
        kind: "attachment",
        attachment: {
          id: `${messageId}:attachment:${index}`,
          path: claudeHistoryAttachmentPath(messageId, index),
          name: `Claude image attachment${extensionForMime(mime)}`,
          kind: "image",
          localPreviewAvailable: false,
          ...(mime ? { mime } : {}),
        },
      });
      continue;
    }
    if (type === "document") {
      const source = isRecord(block.source) ? block.source : {};
      const mime = readStringProp(source, "media_type") ?? "application/pdf";
      const title = readStringProp(block, "title");
      parts.push({
        kind: "attachment",
        attachment: {
          id: `${messageId}:attachment:${index}`,
          path: claudeHistoryAttachmentPath(messageId, index),
          name: title ?? `Claude document attachment${extensionForMime(mime) || ".pdf"}`,
          kind: "pdf",
          mime,
          localPreviewAvailable: false,
        },
      });
    }
  }
  return parts;
};

export const createLiveUserMessageIdResolver = (
  liveUserMessages: readonly ClaudeLiveUserMessage[],
) => {
  const consumedIndexes = new Set<number>();
  return (fallbackMessageId: string, text: string): string => {
    for (let index = 0; index < liveUserMessages.length; index += 1) {
      if (consumedIndexes.has(index)) {
        continue;
      }
      const liveUserMessage = liveUserMessages[index];
      if (!liveUserMessage || liveUserMessage.text !== text) {
        continue;
      }
      consumedIndexes.add(index);
      return liveUserMessage.messageId;
    }
    return fallbackMessageId;
  };
};

export const createHistoryToolPart = (
  messageId: string,
  block: Record<string, unknown>,
  index: number,
  timestamp: string,
): Extract<AgentStreamPart, { kind: "tool" }> | null => {
  const toolUse = decodeClaudeToolUseBlock({
    block,
    fallbackMessageId: messageId,
    index,
  });
  if (!toolUse) {
    return null;
  }
  return createClaudeRunningToolPart({
    messageId,
    startedAtMs: timestampMs(timestamp),
    toolUse,
  });
};

export const readHistoryToolResults = (message: SessionMessage) => {
  const messageRecord = message as unknown as Record<string, unknown>;
  type ClaudeDecodedToolResult = NonNullable<ReturnType<typeof decodeClaudeToolResultValue>>;
  const readTopLevelToolUseResult = (): Record<string, unknown> | null => {
    const camelCaseToolUseResult = messageRecord.toolUseResult;
    if (isRecord(camelCaseToolUseResult)) {
      return camelCaseToolUseResult;
    }
    const snakeCaseToolUseResult = messageRecord.tool_use_result;
    return isRecord(snakeCaseToolUseResult) ? snakeCaseToolUseResult : null;
  };
  const mergeTopLevelToolUseResult = (result: ClaudeDecodedToolResult): ClaudeDecodedToolResult => {
    const toolUseResult = readTopLevelToolUseResult();
    if (!toolUseResult) {
      return result;
    }
    return {
      ...result,
      raw: {
        ...result.raw,
        structuredContent: toolUseResult,
        toolUseResult,
      },
    };
  };
  const direct = decodeClaudeToolResultValue(
    messageRecord.tool_use_result,
    message.parent_tool_use_id,
    { allowNonToolResultType: true },
  );
  if (direct) {
    return [mergeTopLevelToolUseResult(direct)];
  }
  const content = isRecord(message.message) ? message.message.content : undefined;
  if (Array.isArray(content)) {
    const results: ClaudeDecodedToolResult[] = [];
    for (const block of content) {
      const result = decodeClaudeToolResultValue(block, message.parent_tool_use_id);
      if (result) {
        results.push(mergeTopLevelToolUseResult(result));
      }
    }
    if (results.length > 0) {
      return results;
    }
  }
  const camelCaseResult = decodeClaudeToolResultValue(
    messageRecord.toolUseResult,
    message.parent_tool_use_id,
    { allowNonToolResultType: true },
  );
  return camelCaseResult ? [camelCaseResult] : [];
};

export const readHistoryToolResult = (message: SessionMessage) =>
  readHistoryToolResults(message)[0] ?? null;

const readStringArrayProp = (value: unknown, key: string): string[] => {
  if (!isRecord(value)) {
    return [];
  }
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.filter((item): item is string => typeof item === "string" && item.length > 0);
};

export const retractedHistoryMessageIds = (entry: unknown): string[] => [
  ...readStringArrayProp(entry, "supersedes"),
  ...readStringArrayProp(entry, "retracted_message_uuids"),
];

export const hasFinalStopStep = (message: MutableAssistantHistoryMessage): boolean =>
  message.parts.some(
    (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
  );
