import { hasRuntimeType } from "@openducktor/contracts";
import { basename } from "node:path";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentFileReference,
  AgentModelSelection,
  AgentSessionHistoryMessage,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import { decodeClaudeToolResultValue } from "./claude-agent-sdk-tool-shapes";
import { parseClaudeJsonValue } from "./claude-agent-sdk-ingress-schemas";
import { detectFileKind, isRecord, readStringProp } from "./claude-agent-sdk-utils";
import type { JsonValue } from "@openducktor/contracts";

interface MIMEEXTENSIONSContract extends Record<string, string> {}

export type ClaudeLiveUserMessage = {
  isManualCompaction?: true;
  messageId: string;
  model?: AgentModelSelection;
  parts?: AgentUserMessageDisplayPart[];
  state?: "queued" | "read";
  text: string;
  timestamp: string;
};

export const appendUnmatchedLiveUserMessages = (
  history: AgentSessionHistoryMessage[],
  liveUserMessages: readonly ClaudeLiveUserMessage[],
): void => {
  const projectedMessageIds = new Set(history.map((message) => message.messageId));
  for (const message of liveUserMessages) {
    const isDeliveredManualCompaction = message.isManualCompaction && message.state !== "queued";
    if (isDeliveredManualCompaction || projectedMessageIds.has(message.messageId)) {
      continue;
    }
    history.push({
      messageId: message.messageId,
      role: "user",
      timestamp: message.timestamp,
      text: message.text,
      displayParts:
        message.parts ?? (message.text.length > 0 ? [{ kind: "text", text: message.text }] : []),
      state: message.state ?? "read",
      ...(() => {
        if (message.model) {
          return { model: message.model };
        }
        return {};
      })(),
      parts: [],
    });
  }
};

type MutableAssistantHistoryMessage = Extract<AgentSessionHistoryMessage, { role: "assistant" }>;

const CLAUDE_HISTORY_ATTACHMENT_PATH_PREFIX = "claude-history://attachment/";

const MIME_EXTENSIONS: MIMEEXTENSIONSContract = {
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
  part: Extract<AgentUserMessageDisplayPart, { kind: "file_reference" }>;
};

const CLAUDE_FILE_TOKEN_PATTERN = /@(?:"((?:\\.|[^"\\])*)"|([^\s"]+))/gu;
const CLAUDE_FILE_TRAILING_PUNCTUATION_PATTERN = /[,.;!?)}\]]+$/u;
const CLAUDE_REFERENCE_BOUNDARY_PATTERN = /[\s([{"']/u;
const CLAUDE_QUOTED_FILE_ESCAPE_PATTERN = /\\(.)/gu;

const hasClaudeReferenceBoundary = (text: string, start: number): boolean =>
  start === 0 || CLAUDE_REFERENCE_BOUNDARY_PATTERN.test(text[start - 1] ?? "");

// SAFETY: The runtime adapter builds this value from the contract fields required by `AgentFileReference["kind"]`.
const claudeFileReference = (path: string): AgentFileReference => ({
  id: path,
  path,
  name: basename(path.replaceAll("\\", "/")),
  kind: detectFileKind(path, false) as AgentFileReference["kind"],
});

const readClaudeHistoryReferenceRanges = (text: string): ClaudeHistoryReferenceRange[] => {
  const ranges: ClaudeHistoryReferenceRange[] = [];
  for (const match of text.matchAll(CLAUDE_FILE_TOKEN_PATTERN)) {
    const start = match.index;
    if (!hasClaudeReferenceBoundary(text, start)) {
      continue;
    }
    const quotedPath = match[1];
    const path =
      quotedPath === undefined
        ? match[2]?.replace(CLAUDE_FILE_TRAILING_PUNCTUATION_PATTERN, "")
        : quotedPath.replace(CLAUDE_QUOTED_FILE_ESCAPE_PATTERN, "$1");
    if (!path) {
      continue;
    }
    const source = quotedPath === undefined ? `@${path}` : match[0];
    ranges.push({
      start,
      end: start + source.length,
      part: {
        kind: "file_reference",
        file: claudeFileReference(path),
        sourceText: {
          value: source,
          start,
          end: start + source.length,
        },
      },
    });
  }
  return ranges.sort((left, right) => left.start - right.start);
};

const readClaudeHistoryTextDisplayParts = (text: string): AgentUserMessageDisplayPart[] => {
  const ranges = readClaudeHistoryReferenceRanges(text);
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
  message: JsonValue | undefined,
): AgentUserMessageDisplayPart[] => {
  if (!isRecord(message)) {
    return [];
  }
  const content = message.content;
  if (hasRuntimeType(content, "string") && content.length > 0) {
    return readClaudeHistoryTextDisplayParts(content);
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: AgentUserMessageDisplayPart[] = [];
  let flattenedTextLength = 0;
  for (const [index, block] of content.entries()) {
    if (!isRecord(block)) {
      continue;
    }
    const type = readStringProp(block, "type");
    if (type === "text") {
      const text = readStringProp(block, "text");
      if (text) {
        const sourceOffset = flattenedTextLength === 0 ? 0 : flattenedTextLength + 1;
        parts.push(
          ...readClaudeHistoryTextDisplayParts(text).map((part) => {
            if (part.kind !== "file_reference" || !part.sourceText) {
              return part;
            }
            return {
              ...part,
              sourceText: {
                ...part.sourceText,
                start: part.sourceText.start + sourceOffset,
                end: part.sourceText.end + sourceOffset,
              },
            };
          }),
        );
        flattenedTextLength = sourceOffset + text.length;
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
          ...(() => {
            if (mime) {
              return { mime };
            }
            return {};
          })(),
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

export const createLiveUserMessageResolver = (
  liveUserMessages: readonly ClaudeLiveUserMessage[],
) => {
  const consumedIndexes = new Set<number>();
  const findUnconsumedIndex = (predicate: (message: ClaudeLiveUserMessage) => boolean): number => {
    for (let index = 0; index < liveUserMessages.length; index += 1) {
      if (consumedIndexes.has(index)) {
        continue;
      }
      const liveUserMessage = liveUserMessages[index];
      if (liveUserMessage && predicate(liveUserMessage)) {
        return index;
      }
    }
    return -1;
  };
  return (
    fallbackMessageId: string,
    text: string,
    timestamp: string,
  ): ClaudeLiveUserMessage | undefined => {
    let matchingIndex = findUnconsumedIndex((message) => message.messageId === fallbackMessageId);
    if (matchingIndex < 0) {
      matchingIndex = findUnconsumedIndex(
        (message) => message.text === text && message.timestamp === timestamp,
      );
    }
    const liveUserMessage = liveUserMessages[matchingIndex];
    if (matchingIndex < 0 || !liveUserMessage) {
      return undefined;
    }
    consumedIndexes.add(matchingIndex);
    return liveUserMessage;
  };
};

export const readHistoryToolResults = (message: SessionMessage) => {
  const messageRecord = parseClaudeJsonValue(message, "claudeHistoryMessage");
  if (!isRecord(messageRecord)) {
    return [];
  }
  type ClaudeDecodedToolResult = NonNullable<ReturnType<typeof decodeClaudeToolResultValue>>;
  const readTopLevelToolUseResult = (): Record<string, JsonValue> | null => {
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
  const content = isRecord(messageRecord.message) ? messageRecord.message.content : undefined;
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

const readStringArrayProp = (value: JsonValue | undefined, key: string): string[] => {
  if (!isRecord(value)) {
    return [];
  }
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.filter((item): item is string => typeof item === "string" && item.length > 0);
};

export const retractedHistoryMessageIds = (entry: JsonValue | undefined): string[] => [
  ...readStringArrayProp(entry, "supersedes"),
  ...readStringArrayProp(entry, "retracted_message_uuids"),
];

export const hasFinalStopStep = (message: MutableAssistantHistoryMessage): boolean =>
  message.parts.some(
    (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
  );
