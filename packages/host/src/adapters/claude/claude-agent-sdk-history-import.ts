import {
  importSessionToStore,
  type SessionKey,
  type SessionMessage,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

export type ClaudeHistoryResultMessage = SessionStoreEntry & {
  type: "result";
  errors?: unknown;
  is_error?: unknown;
  retracted_message_uuids?: unknown;
  result?: unknown;
  subtype?: unknown;
  stop_reason?: string | null;
  terminal_reason?: unknown;
  usage?: unknown;
};

export type ClaudeHistoryRetractionMessage = SessionStoreEntry & {
  type: "system";
  subtype: "model_refusal_fallback";
  retracted_message_uuids?: unknown;
};

export type ClaudeHistorySubagentSystemMessage = SessionStoreEntry & {
  type: "system";
  subtype: "task_started" | "task_progress" | "task_updated" | "task_notification";
};

export type ClaudeHistoryCompactBoundaryMessage = SessionStoreEntry & {
  type: "system";
  subtype: "compact_boundary";
  compact_metadata?: unknown;
  uuid: string;
};

export type ClaudeHistoryLocalCommandMessage = SessionStoreEntry & {
  type: "system";
  subtype: "local_command" | "local_command_output";
  content: unknown;
  uuid: string;
};

export type ClaudeHistoryQueueOperationMessage = SessionStoreEntry & {
  type: "queue-operation";
  operation: "enqueue";
  content: unknown;
};

export type ClaudeHistoryMessage =
  | SessionMessage
  | ClaudeHistoryResultMessage
  | ClaudeHistoryRetractionMessage
  | ClaudeHistorySubagentSystemMessage
  | ClaudeHistoryCompactBoundaryMessage
  | ClaudeHistoryLocalCommandMessage
  | ClaudeHistoryQueueOperationMessage;

export type ClaudeHistoryEntryMetadata = {
  interruptedByShutdown?: unknown;
  isMeta?: unknown;
  isSidechain?: unknown;
  subagent_type?: unknown;
  timestamp?: unknown;
};

const isMainClaudeHistoryMessage = (entry: SessionStoreEntry): entry is ClaudeHistoryMessage => {
  if (entry.type === "queue-operation") {
    return readStringProp(entry, "operation") === "enqueue" && typeof entry.content === "string";
  }
  if (entry.type === "assistant" || entry.type === "user" || entry.type === "system") {
    const subtype = isRecord(entry) ? readStringProp(entry, "subtype") : undefined;
    if (entry.type === "system" && subtype === "model_refusal_fallback") {
      return typeof entry.uuid === "string";
    }
    if (entry.type === "system" && subtype === "compact_boundary") {
      return typeof entry.uuid === "string";
    }
    if (
      entry.type === "system" &&
      (subtype === "task_started" ||
        subtype === "task_progress" ||
        subtype === "task_updated" ||
        subtype === "task_notification")
    ) {
      return typeof entry.uuid === "string";
    }
    if (
      entry.type === "system" &&
      (subtype === "local_command" || subtype === "local_command_output")
    ) {
      return typeof entry.uuid === "string" && typeof entry.content === "string";
    }
    return typeof entry.uuid === "string" && "message" in entry;
  }
  return entry.type === "result";
};

const queuedPromptKey = (
  timestamp: string | undefined,
  prompt: string | undefined,
): string | null => (timestamp && prompt ? JSON.stringify([timestamp, prompt]) : null);

const readMetaQueuedPromptKey = (entry: SessionStoreEntry): string | null => {
  if (entry.type !== "attachment" || !isRecord(entry)) {
    return null;
  }
  const attachment = entry.attachment;
  if (
    !isRecord(attachment) ||
    readStringProp(attachment, "type") !== "queued_command" ||
    attachment.isMeta !== true
  ) {
    return null;
  }
  return queuedPromptKey(
    readStringProp(entry, "timestamp") ?? readStringProp(attachment, "timestamp"),
    readStringProp(attachment, "prompt"),
  );
};

const readQueuedPromptKey = (entry: SessionStoreEntry): string | null => {
  if (entry.type !== "queue-operation" || readStringProp(entry, "operation") !== "enqueue") {
    return null;
  }
  return queuedPromptKey(readStringProp(entry, "timestamp"), readStringProp(entry, "content"));
};

export const filterClaudeHistoryMessages = (
  entries: readonly SessionStoreEntry[],
): ClaudeHistoryMessage[] => {
  const metaQueuedPromptKeys = new Set(entries.map(readMetaQueuedPromptKey).filter(Boolean));
  return entries.filter((entry): entry is ClaudeHistoryMessage => {
    if (!isMainClaudeHistoryMessage(entry)) {
      return false;
    }
    const key = readQueuedPromptKey(entry);
    return key === null || !metaQueuedPromptKeys.has(key);
  });
};

export const isClaudeHistorySubagentSystemMessage = (
  entry: ClaudeHistoryMessage,
): entry is ClaudeHistorySubagentSystemMessage =>
  entry.type === "system" &&
  isRecord(entry) &&
  (readStringProp(entry, "subtype") === "task_started" ||
    readStringProp(entry, "subtype") === "task_progress" ||
    readStringProp(entry, "subtype") === "task_updated" ||
    readStringProp(entry, "subtype") === "task_notification");

export const isClaudeHistoryCompactBoundaryMessage = (
  entry: ClaudeHistoryMessage,
): entry is ClaudeHistoryCompactBoundaryMessage =>
  entry.type === "system" &&
  isRecord(entry) &&
  readStringProp(entry, "subtype") === "compact_boundary";

const createClaudeHistoryImportStore = (target: { sessionId: string; subpath?: string }) => {
  const entries: SessionStoreEntry[] = [];
  const keyMatchesMainTranscript = (key: SessionKey): boolean =>
    key.sessionId === target.sessionId && key.subpath === undefined;
  const keyMatchesTargetTranscript = (key: SessionKey): boolean =>
    target.subpath === undefined
      ? keyMatchesMainTranscript(key)
      : key.sessionId === target.sessionId && key.subpath === target.subpath;
  const store: SessionStore = {
    append: async (key, nextEntries) => {
      if (!keyMatchesTargetTranscript(key)) {
        return;
      }
      entries.push(...nextEntries);
    },
    load: async (key) => (keyMatchesTargetTranscript(key) ? entries : null),
  };
  return { entries, store };
};

const isMissingClaudeSessionError = (error: unknown, sessionId: string): boolean =>
  error instanceof Error && error.message === `Session ${sessionId} not found`;

export const loadClaudeRawHistoryMessages = async (
  input: LoadAgentSessionHistoryInput,
): Promise<ClaudeHistoryMessage[]> => {
  const target = parseClaudeTranscriptTarget(input.externalSessionId);
  const { entries, store } = createClaudeHistoryImportStore(target);
  try {
    await importSessionToStore(target.sessionId, store, {
      dir: input.workingDirectory,
      includeSubagents: target.subpath !== undefined,
    });
  } catch (error) {
    if (isMissingClaudeSessionError(error, target.sessionId)) {
      return [];
    }
    throw error;
  }
  return filterClaudeHistoryMessages(entries);
};
