import {
  importSessionToStore,
  type SessionKey,
  type SessionMessage,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  parseClaudeHistoryAssistantEntry,
  parseClaudeHistoryAttachment,
  parseClaudeHistoryAttachmentEntry,
  parseClaudeHistoryConversationEntry,
  parseClaudeHistoryStoreEntry,
  parseClaudeHistorySubagentSystemMessageIngress,
  parseClaudeMetaQueuedCommandAttachment,
  type ClaudeHistorySubagentSystemMessageIngress,
} from "./claude-agent-sdk-ingress-schemas";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { readStringProp } from "./claude-agent-sdk-utils";

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

export type ClaudeHistorySubagentSystemMessage = SessionStoreEntry &
  ClaudeHistorySubagentSystemMessageIngress;

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

export type ClaudeHistoryConversationMessage = SessionMessage & SessionStoreEntry;

export type ClaudeHistoryMessage =
  | ClaudeHistoryConversationMessage
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

const sessionStoreEntryValue = (entry: SessionStoreEntry) => parseClaudeHistoryStoreEntry(entry);

const isMainClaudeHistoryMessage = (entry: SessionStoreEntry): entry is ClaudeHistoryMessage => {
  const value = sessionStoreEntryValue(entry);
  if (entry.type === "queue-operation") {
    return readStringProp(value, "operation") === "enqueue" && typeof entry.content === "string";
  }
  if (entry.type === "assistant" || entry.type === "user" || entry.type === "system") {
    const subtype = readStringProp(value, "subtype");
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
      parseClaudeHistorySubagentSystemMessageIngress(entry);
      return true;
    }
    if (
      entry.type === "system" &&
      (subtype === "local_command" || subtype === "local_command_output")
    ) {
      return typeof entry.uuid === "string" && typeof entry.content === "string";
    }
    if (entry.type === "assistant") {
      parseClaudeHistoryAssistantEntry(value);
    } else if (entry.type === "user") {
      parseClaudeHistoryConversationEntry(value);
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
  const value = sessionStoreEntryValue(entry);
  if (entry.type !== "attachment") {
    return null;
  }
  const attachmentEntry = parseClaudeHistoryAttachmentEntry(value);
  const attachment = parseClaudeHistoryAttachment(attachmentEntry.attachment);
  if (attachment.type !== "queued_command" || attachment.isMeta !== true) {
    return null;
  }
  const metaQueuedCommand = parseClaudeMetaQueuedCommandAttachment(attachmentEntry.attachment);
  return queuedPromptKey(
    readStringProp(value, "timestamp") ?? metaQueuedCommand.timestamp,
    metaQueuedCommand.prompt,
  );
};

const readQueuedPromptKey = (entry: SessionStoreEntry): string | null => {
  const value = sessionStoreEntryValue(entry);
  if (entry.type !== "queue-operation" || readStringProp(value, "operation") !== "enqueue") {
    return null;
  }
  return queuedPromptKey(readStringProp(value, "timestamp"), readStringProp(value, "content"));
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
): entry is ClaudeHistorySubagentSystemMessage => {
  const value = sessionStoreEntryValue(entry);
  if (entry.type !== "system") return false;
  const subtype = readStringProp(value, "subtype");
  if (
    subtype !== "task_started" &&
    subtype !== "task_progress" &&
    subtype !== "task_updated" &&
    subtype !== "task_notification"
  ) {
    return false;
  }
  parseClaudeHistorySubagentSystemMessageIngress(entry);
  return true;
};

export const isClaudeHistoryCompactBoundaryMessage = (
  entry: ClaudeHistoryMessage,
): entry is ClaudeHistoryCompactBoundaryMessage => {
  const value = sessionStoreEntryValue(entry);
  return entry.type === "system" && readStringProp(value, "subtype") === "compact_boundary";
};

const createClaudeHistoryImportStore = (target: { sessionId: string; subpath?: string }) => {
  const entriesBySubpath = new Map<string | undefined, SessionStoreEntry[]>();
  const keyMatchesSession = (key: SessionKey): boolean => key.sessionId === target.sessionId;
  const store: SessionStore = {
    append: async (key, nextEntries) => {
      if (!keyMatchesSession(key)) {
        return;
      }
      const entries = entriesBySubpath.get(key.subpath) ?? [];
      nextEntries.forEach(parseClaudeHistoryStoreEntry);
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
    const value = sessionStoreEntryValue(entry);
    if (entry.type !== "assistant") {
      continue;
    }
    const content = parseClaudeHistoryAssistantEntry(value).message.content;
    for (const block of content) {
      if (block.type === "tool_use" && readStringProp(block, "name") === "Agent") {
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
      .map((entry) => readStringProp(sessionStoreEntryValue(entry), "parent_tool_use_id"))
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
    if (cause instanceof HostValidationError) {
      throw cause;
    }
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
