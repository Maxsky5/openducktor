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

export type ClaudeHistoryMessage =
  | SessionMessage
  | ClaudeHistoryResultMessage
  | ClaudeHistoryRetractionMessage
  | ClaudeHistorySubagentSystemMessage;

export type ClaudeHistoryEntryMetadata = {
  isSidechain?: unknown;
  subagent_type?: unknown;
  timestamp?: unknown;
};

const isMainClaudeHistoryMessage = (entry: SessionStoreEntry): entry is ClaudeHistoryMessage => {
  if (entry.type === "assistant" || entry.type === "user" || entry.type === "system") {
    const subtype = isRecord(entry) ? readStringProp(entry, "subtype") : undefined;
    if (entry.type === "system" && subtype === "model_refusal_fallback") {
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
    return typeof entry.uuid === "string" && "message" in entry;
  }
  return entry.type === "result";
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
  return entries.filter(isMainClaudeHistoryMessage);
};
