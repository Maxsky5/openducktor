import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { AgentRuntimeQueryError, type LoadAgentSessionHistoryInput } from "@openducktor/core";
import { z } from "zod";
import {
  errorMessage,
  HostOperationError,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import {
  parseClaudeHistoryAssistantEntry,
  parseClaudeHistoryConversationEntry,
  parseClaudeHistorySubagentSystemMessageIngress,
  type ClaudeHistorySubagentSystemMessageIngress,
} from "./claude-agent-sdk-ingress-schemas";
import {
  CLAUDE_TRANSCRIPT_MISSING_MESSAGE,
  readClaudeTranscript,
  type ClaudeTranscriptReadOptions,
  type ClaudeTranscriptReadFailure,
  type ClaudeTranscriptSource,
} from "./claude-transcript-reader";
import { readText } from "./claude-agent-sdk-utils";

type ClaudeHistoryEntry = {
  uuid?: string;
  timestamp?: string;
  session_id?: string;
  subtype?: unknown;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  is_meta?: boolean;
  interruptedByShutdown?: boolean;
  toolUseResult?: unknown;
  tool_use_result?: unknown;
  retracted_message_uuids?: unknown;
  supersedes?: unknown;
  tasks?: unknown;
};

export type ClaudeHistoryResultMessage = ClaudeHistoryEntry & {
  type: "result";
  errors?: unknown;
  is_error?: unknown;
  retracted_message_uuids?: unknown;
  result?: unknown;
  subtype?: unknown;
  stop_reason?: string | null;
  terminal_reason?: unknown;
  usage?: unknown;
  modelUsage?: unknown;
};

export type ClaudeHistoryRetractionMessage = ClaudeHistoryEntry & {
  type: "system";
  subtype: "model_refusal_fallback";
  retracted_message_uuids?: unknown;
};

export type ClaudeHistorySubagentSystemMessage = ClaudeHistoryEntry &
  ClaudeHistorySubagentSystemMessageIngress;

export type ClaudeHistoryBackgroundTasksChangedMessage = ClaudeHistoryEntry & {
  type: "system";
  subtype: "background_tasks_changed";
  tasks: Array<{ task_id: string; task_type: string; description: string; ambient?: boolean }>;
};

export type ClaudeHistoryCompactBoundaryMessage = ClaudeHistoryEntry & {
  type: "system";
  subtype: "compact_boundary";
  compact_metadata?: unknown;
  uuid: string;
};

export type ClaudeHistoryLocalCommandMessage = ClaudeHistoryEntry & {
  type: "system";
  subtype: "local_command" | "local_command_output";
  content: unknown;
  uuid: string;
};

export type ClaudeHistoryQueueOperationMessage = ClaudeHistoryEntry & {
  type: "queue-operation";
  operation: "enqueue";
  content: unknown;
};

export type ClaudeHistoryConversationMessage = SessionMessage & ClaudeHistoryEntry;

export type ClaudeHistoryMessage =
  | ClaudeHistoryConversationMessage
  | ClaudeHistoryResultMessage
  | ClaudeHistoryRetractionMessage
  | ClaudeHistorySubagentSystemMessage
  | ClaudeHistoryBackgroundTasksChangedMessage
  | ClaudeHistoryCompactBoundaryMessage
  | ClaudeHistoryLocalCommandMessage
  | ClaudeHistoryQueueOperationMessage;

export const parseClaudeHistoryMessages = (messages: SessionMessage[]): SessionMessage[] => {
  for (const message of messages) {
    if (message.type === "assistant") {
      parseClaudeHistoryAssistantEntry(message);
    } else if (message.type === "user") {
      parseClaudeHistoryConversationEntry(message);
    }
  }
  return messages;
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

const claudeNativeConversationIdentitySchema = z.object({
  uuid: z.string(),
  session_id: z.string(),
});

export const isClaudeSessionMissingError = (cause: unknown): boolean =>
  cause instanceof AgentRuntimeQueryError &&
  cause.code === "request_failed" &&
  cause.message === CLAUDE_TRANSCRIPT_MISSING_MESSAGE;

export type ClaudeHistoryReadFailure = ClaudeTranscriptReadFailure | HostValidationErrorAggregate;

export const loadClaudeHistoryProjectionInput = (
  input: LoadAgentSessionHistoryInput,
  options: ClaudeTranscriptReadOptions = {},
): Effect.Effect<
  { messages: readonly ClaudeHistoryMessage[]; source: ClaudeTranscriptSource },
  ClaudeHistoryReadFailure
> =>
  Effect.gen(function* () {
    const result = yield* options.reader
      ? options.reader.read(input)
      : readClaudeTranscript(input, options);
    return yield* Effect.try({
      try: () => {
        for (const record of result.messages) {
          if (record.type === "user" || record.type === "assistant") {
            claudeNativeConversationIdentitySchema.parse(record);
            const entry = { ...record, type: record.type };
            if (record.type === "assistant") parseClaudeHistoryAssistantEntry(entry);
            else parseClaudeHistoryConversationEntry(entry);
          }
        }
        // SAFETY: Conversation identities and payloads are validated above; the reader retains only recognized native history record kinds.
        return {
          messages: result.messages as readonly ClaudeHistoryMessage[],
          source: result.source,
        };
      },
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostOperationError({
              operation: "claude.session.history.read",
              message: `Failed to read Claude session '${input.externalSessionId}' history: ${errorMessage(cause)}`,
              cause,
            }),
    });
  });

export const loadClaudeSessionMessages = (
  input: LoadAgentSessionHistoryInput,
  options: ClaudeTranscriptReadOptions = {},
): Effect.Effect<readonly ClaudeHistoryMessage[], ClaudeHistoryReadFailure> =>
  loadClaudeHistoryProjectionInput(input, options).pipe(Effect.map((result) => result.messages));
