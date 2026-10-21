import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { AgentRuntimeQueryError, type LoadAgentSessionHistoryInput } from "@openducktor/core";
import { z } from "zod";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  parseClaudeHistoryAssistantEntry,
  parseClaudeHistoryConversationEntry,
  parseClaudeHistorySubagentSystemMessageIngress,
  type ClaudeHistorySubagentSystemMessageIngress,
} from "./claude-agent-sdk-ingress-schemas";
import {
  claudeSubagentAgentId,
  parseClaudeTranscriptTarget,
} from "./claude-agent-sdk-subagent-transcripts";
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

const CLAUDE_SESSION_MISSING_MESSAGE =
  "The selected Claude session is unavailable. Check its history on the host.";

export const isClaudeSessionMissingError = (cause: unknown): boolean =>
  cause instanceof AgentRuntimeQueryError &&
  cause.code === "request_failed" &&
  cause.message === CLAUDE_SESSION_MISSING_MESSAGE;

export const loadClaudeSessionMessages = async (
  input: LoadAgentSessionHistoryInput,
): Promise<SessionMessage[]> => {
  const target = parseClaudeTranscriptTarget(input.externalSessionId);
  if (!z.uuid().safeParse(target.sessionId).success) {
    throw new AgentRuntimeQueryError("request_failed", CLAUDE_SESSION_MISSING_MESSAGE);
  }
  try {
    const session = await getSessionInfo(target.sessionId, { dir: input.workingDirectory });
    if (!session || session.sessionId !== target.sessionId || !session.cwd) {
      throw new AgentRuntimeQueryError("request_failed", CLAUDE_SESSION_MISSING_MESSAGE);
    }
    if (session.cwd !== input.workingDirectory) {
      throw new AgentRuntimeQueryError(
        "scope_mismatch",
        "The Claude session belongs to another working directory. Select the matching session.",
      );
    }
    const agentId = claudeSubagentAgentId(input.externalSessionId);
    const messages = agentId
      ? await getSubagentMessages(target.sessionId, agentId, { dir: input.workingDirectory })
      : await getSessionMessages(target.sessionId, {
          dir: input.workingDirectory,
          includeSystemMessages: true,
        });
    if (messages.length === 0) {
      throw new AgentRuntimeQueryError("request_failed", CLAUDE_SESSION_MISSING_MESSAGE);
    }
    return parseClaudeHistoryMessages(messages);
  } catch (cause) {
    if (cause instanceof AgentRuntimeQueryError || cause instanceof HostValidationError)
      throw cause;
    throw new HostOperationError({
      operation: "claude.session.history.read",
      message: `Failed to read Claude session '${target.sessionId}' history: ${errorMessage(cause)}`,
      cause,
      details: {
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      },
    });
  }
};
