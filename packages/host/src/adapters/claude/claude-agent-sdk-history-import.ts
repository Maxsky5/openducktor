import {
  importSessionToStore,
  type SessionKey,
  type SessionMessage,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
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
  const entriesBySubpath = new Map<string | undefined, SessionStoreEntry[]>();
  const keyMatchesSession = (key: SessionKey): boolean => key.sessionId === target.sessionId;
  const store: SessionStore = {
    append: async (key, nextEntries) => {
      if (!keyMatchesSession(key)) {
        return;
      }
      const entries = entriesBySubpath.get(key.subpath) ?? [];
      entries.push(...nextEntries);
      entriesBySubpath.set(key.subpath, entries);
    },
    load: async (key) =>
      keyMatchesSession(key) ? (entriesBySubpath.get(key.subpath) ?? null) : null,
  };
  return { entriesBySubpath, store };
};

const readAgentToolUseIds = (entries: readonly SessionStoreEntry[]): Set<string> => {
  const toolUseIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "assistant" || !isRecord(entry.message)) {
      continue;
    }
    const content = entry.message.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (
        isRecord(block) &&
        readStringProp(block, "type") === "tool_use" &&
        readStringProp(block, "name") === "Agent"
      ) {
        const toolUseId = readStringProp(block, "id");
        if (toolUseId) {
          toolUseIds.add(toolUseId);
        }
      }
    }
  }
  return toolUseIds;
};

const readSubagentAgentId = (subpath: string): string | undefined => {
  const prefix = "subagents/agent-";
  return subpath.startsWith(prefix) ? subpath.slice(prefix.length) || undefined : undefined;
};

export const readSubagentAgentIdsByToolUseId = (
  entriesBySubpath: ReadonlyMap<string | undefined, readonly SessionStoreEntry[]>,
  targetSubpath: string | undefined,
): Map<string, string> => {
  const targetToolUseIds = readAgentToolUseIds(entriesBySubpath.get(targetSubpath) ?? []);
  const agentIdsByToolUseId = new Map<string, string>();
  for (const [subpath, entries] of entriesBySubpath) {
    if (!subpath || subpath === targetSubpath) {
      continue;
    }
    const agentId = readSubagentAgentId(subpath);
    const parentToolUseId = entries
      .map((entry) => readStringProp(entry, "parent_tool_use_id"))
      .find((value): value is string => Boolean(value));
    if (agentId && parentToolUseId && targetToolUseIds.has(parentToolUseId)) {
      agentIdsByToolUseId.set(parentToolUseId, agentId);
    }
  }
  return agentIdsByToolUseId;
};

export type ClaudeHistoryProjectionInput = {
  messages: ClaudeHistoryMessage[];
  subagentAgentIdsByToolUseId: Map<string, string>;
};

export const loadClaudeHistoryProjectionInput = async (
  input: LoadAgentSessionHistoryInput,
): Promise<ClaudeHistoryProjectionInput> => {
  const target = parseClaudeTranscriptTarget(input.externalSessionId);
  const { entriesBySubpath, store } = createClaudeHistoryImportStore(target);
  try {
    await importSessionToStore(target.sessionId, store, {
      dir: input.workingDirectory,
      includeSubagents: true,
    });
  } catch (cause) {
    throw new HostOperationError({
      operation: "claude.session.history.import",
      message: `Failed to load Claude session '${target.sessionId}' history: ${errorMessage(cause)}`,
      cause,
      details: {
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      },
    });
  }
  return {
    messages: filterClaudeHistoryMessages(entriesBySubpath.get(target.subpath) ?? []),
    subagentAgentIdsByToolUseId: readSubagentAgentIdsByToolUseId(entriesBySubpath, target.subpath),
  };
};

export const loadClaudeRawHistoryMessages = async (
  input: LoadAgentSessionHistoryInput,
): Promise<ClaudeHistoryMessage[]> => (await loadClaudeHistoryProjectionInput(input)).messages;
