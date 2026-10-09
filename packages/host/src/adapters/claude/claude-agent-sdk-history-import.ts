import {
  getSessionInfo,
  importSessionToStore,
  type SessionKey,
  type SessionMessage,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { AgentRuntimeQueryError, type LoadAgentSessionHistoryInput } from "@openducktor/core";
import { z } from "zod";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  parseClaudeHistoryAssistantEntry,
  parseClaudeHistoryConversationEntry,
  parseClaudeHistoryStoreEntry,
  parseClaudeHistorySubagentSystemMessageIngress,
  parseClaudeMetaQueuedCommandAttachment,
  type ClaudeHistorySubagentSystemMessageIngress,
} from "./claude-agent-sdk-ingress-schemas";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { readText } from "./claude-agent-sdk-utils";

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

export type ClaudeHistoryBackgroundTasksChangedMessage = SessionStoreEntry & {
  type: "system";
  subtype: "background_tasks_changed";
  tasks: Array<{ task_id: string; task_type: string; description: string; ambient?: boolean }>;
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

export type ClaudeHistoryConversationMessage = SessionMessage & SessionStoreEntry;

export type ClaudeHistoryMessage =
  | ClaudeHistoryConversationMessage
  | ClaudeHistoryResultMessage
  | ClaudeHistoryRetractionMessage
  | ClaudeHistorySubagentSystemMessage
  | ClaudeHistoryBackgroundTasksChangedMessage
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

const claudeHistoryBackgroundTasksSchema = z.array(
  z.object({
    task_id: z.string(),
    task_type: z.string(),
    description: z.string(),
    ambient: z.boolean().optional(),
  }),
);

/* oxlint-disable anti-slop/no-runtime-typeof -- SDK entries are validated on import. Classify opaque variants before parsing the fields we consume. */
const isMainClaudeHistoryMessage = (entry: SessionStoreEntry): entry is ClaudeHistoryMessage => {
  if (entry.type === "queue-operation") {
    return entry.operation === "enqueue" && typeof entry.content === "string";
  }
  if (entry.type === "assistant" || entry.type === "user" || entry.type === "system") {
    const subtype = entry.type === "system" ? readText(entry.subtype) : undefined;
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
    if (entry.type === "system" && subtype === "background_tasks_changed") {
      return claudeHistoryBackgroundTasksSchema.safeParse(entry.tasks).success;
    }
    if (
      entry.type === "system" &&
      (subtype === "local_command" || subtype === "local_command_output")
    ) {
      return typeof entry.uuid === "string" && typeof entry.content === "string";
    }
    if (entry.type === "assistant") {
      parseClaudeHistoryAssistantEntry(entry);
    } else if (entry.type === "user") {
      parseClaudeHistoryConversationEntry(entry);
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
  if (entry.type !== "attachment") {
    return null;
  }
  const attachment = entry.attachment;
  if (
    typeof attachment !== "object" ||
    attachment === null ||
    !("type" in attachment) ||
    attachment.type !== "queued_command" ||
    !("isMeta" in attachment) ||
    attachment.isMeta !== true
  ) {
    return null;
  }
  // Native content-block prompts have no string queue key and need no deduplication parse.
  if ("prompt" in attachment && Array.isArray(attachment.prompt)) {
    return null;
  }
  const metaQueuedCommand = parseClaudeMetaQueuedCommandAttachment({
    prompt: "prompt" in attachment ? attachment.prompt : undefined,
    timestamp:
      readText(entry.timestamp) ?? ("timestamp" in attachment ? attachment.timestamp : undefined),
  });
  return queuedPromptKey(metaQueuedCommand.timestamp, metaQueuedCommand.prompt);
};
/* oxlint-enable anti-slop/no-runtime-typeof */

const readQueuedPromptKey = (entry: SessionStoreEntry): string | null => {
  if (entry.type !== "queue-operation" || entry.operation !== "enqueue") {
    return null;
  }
  return queuedPromptKey(readText(entry.timestamp), readText(entry.content));
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
  if (entry.type !== "system") return false;
  const subtype = readText(entry.subtype);
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

export const isClaudeHistoryBackgroundTasksChangedMessage = (
  entry: ClaudeHistoryMessage,
): entry is ClaudeHistoryBackgroundTasksChangedMessage =>
  entry.type === "system" && readText(entry.subtype) === "background_tasks_changed";

export const isClaudeHistoryCompactBoundaryMessage = (
  entry: ClaudeHistoryMessage,
): entry is ClaudeHistoryCompactBoundaryMessage =>
  entry.type === "system" && readText(entry.subtype) === "compact_boundary";

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
    if (entry.type !== "assistant") {
      continue;
    }
    const content = parseClaudeHistoryAssistantEntry(entry).message.content;
    for (const block of content) {
      if (block.type === "tool_use" && readText(block.name) === "Agent") {
        const toolUseId = readText(block.id);
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
      .map((entry) => readText(entry.parent_tool_use_id))
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

const CLAUDE_SESSION_MISSING_MESSAGE =
  "The selected Claude session is unavailable. Check its history on the host.";

export const isClaudeSessionMissingError = (cause: unknown): boolean =>
  cause instanceof AgentRuntimeQueryError &&
  cause.code === "request_failed" &&
  cause.message === CLAUDE_SESSION_MISSING_MESSAGE;

export const loadClaudeHistoryProjectionInput = async (
  input: LoadAgentSessionHistoryInput,
): Promise<ClaudeHistoryProjectionInput> => {
  const target = parseClaudeTranscriptTarget(input.externalSessionId);
  const session = await getSessionInfo(target.sessionId, { dir: input.workingDirectory });
  if (!session || session.sessionId !== target.sessionId) {
    throw new AgentRuntimeQueryError("request_failed", CLAUDE_SESSION_MISSING_MESSAGE);
  }
  if (session.cwd !== input.workingDirectory) {
    throw new AgentRuntimeQueryError(
      "scope_mismatch",
      "The Claude session belongs to another working directory. Select the matching session.",
    );
  }
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
  const entries = entriesBySubpath.get(target.subpath);
  if (!entries && target.subpath) {
    throw new AgentRuntimeQueryError(
      "request_failed",
      "The selected Claude transcript is unavailable. Check its history on the host.",
    );
  }
  return {
    messages: filterClaudeHistoryMessages(entries ?? []),
    subagentAgentIdsByToolUseId: readSubagentAgentIdsByToolUseId(entriesBySubpath, target.subpath),
  };
};

export const loadClaudeRawHistoryMessages = async (
  input: LoadAgentSessionHistoryInput,
): Promise<ClaudeHistoryMessage[]> => (await loadClaudeHistoryProjectionInput(input)).messages;
