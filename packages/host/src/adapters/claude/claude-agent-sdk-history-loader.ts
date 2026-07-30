import { getSubagentMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionHistoryMessage, LoadAgentSessionHistoryInput } from "@openducktor/core";
import { AGENT_SESSION_SYSTEM_PROMPT_PREFIX } from "@openducktor/core";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { isLiveFinalAssistantStopReason } from "./claude-agent-sdk-history-assistant";
import {
  type ClaudeHistoryMessage,
  loadClaudeHistoryProjectionInput,
} from "./claude-agent-sdk-history-import";
import type { ClaudeLiveUserMessage } from "./claude-agent-sdk-history-support";
import {
  claudeSubagentAgentId,
  isClaudeSubagentTranscriptTarget,
  parseClaudeTranscriptTarget,
} from "./claude-agent-sdk-subagent-transcripts";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

export type ClaudeLiveHistoryContext = {
  source: "fresh" | "persisted";
  userMessages: readonly ClaudeLiveUserMessage[];
};

export const isClaudeSubagentTranscriptComplete = (
  messages: readonly SessionMessage[],
): boolean => {
  const lastMessage = messages.at(-1);
  return (
    lastMessage?.type === "assistant" &&
    isRecord(lastMessage.message) &&
    isLiveFinalAssistantStopReason(readStringProp(lastMessage.message, "stop_reason"))
  );
};

const hasClaudeSubagentFinalText = (messages: readonly SessionMessage[]): boolean => {
  const lastMessage = messages.at(-1);
  if (lastMessage?.type !== "assistant" || !isRecord(lastMessage.message)) {
    return false;
  }
  const content = lastMessage.message.content;
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        isRecord(block) &&
        readStringProp(block, "type") === "text" &&
        Boolean(readStringProp(block, "text")?.trim()),
    )
  );
};

export const reconciledClaudeSubagentStatus = (
  parentMessages: readonly SessionMessage[],
  childMessages: readonly SessionMessage[],
): "cancelled" | "completed" | null => {
  if (isClaudeSubagentTranscriptComplete(childMessages)) {
    return "completed";
  }
  if (!isClaudeSubagentTranscriptComplete(parentMessages)) {
    return null;
  }
  return hasClaudeSubagentFinalText(childMessages) ? "completed" : "cancelled";
};

const reconcileClaudeSubagentStatuses = async (
  input: LoadAgentSessionHistoryInput,
  history: AgentSessionHistoryMessage[],
  rootMessages: readonly SessionMessage[],
): Promise<void> => {
  const latestStatusBySessionId = new Map<string, { agentId?: string; status: string }>();
  for (const message of history) {
    for (const part of message.parts) {
      if (part.kind !== "subagent" || !part.externalSessionId) {
        continue;
      }
      const previous = latestStatusBySessionId.get(part.externalSessionId);
      const agentId = isRecord(part.metadata)
        ? readStringProp(part.metadata, "agentId")
        : undefined;
      const resolvedAgentId = agentId ?? previous?.agentId;
      latestStatusBySessionId.set(part.externalSessionId, {
        status: part.status,
        ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
      });
    }
  }
  const runningAgentIds = [...latestStatusBySessionId.values()].flatMap(({ agentId, status }) =>
    status === "running" && agentId ? [agentId] : [],
  );
  if (runningAgentIds.length === 0) {
    return;
  }
  const target = parseClaudeTranscriptTarget(input.externalSessionId);
  const selectedAgentId = claudeSubagentAgentId(input.externalSessionId);
  let terminalStatuses: Map<string, "cancelled" | "completed">;
  try {
    const selectedAgentMessages = selectedAgentId
      ? await getSubagentMessages(target.sessionId, selectedAgentId, {
          dir: input.workingDirectory,
        })
      : rootMessages;
    const completionStates = await Promise.all(
      runningAgentIds.map(async (agentId) => {
        const messages = await getSubagentMessages(target.sessionId, agentId, {
          dir: input.workingDirectory,
        });
        return [agentId, reconciledClaudeSubagentStatus(selectedAgentMessages, messages)] as const;
      }),
    );
    terminalStatuses = new Map(
      completionStates.filter(
        (entry): entry is readonly [string, "cancelled" | "completed"] => entry[1] !== null,
      ),
    );
  } catch (cause) {
    throw new HostOperationError({
      operation: "claude.session.history.subagent-status",
      message: `Failed to load Claude subagent status: ${errorMessage(cause)}`,
      cause,
      details: {
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
      },
    });
  }
  if (terminalStatuses.size === 0) {
    return;
  }
  for (const message of history) {
    message.parts = message.parts.map((part) => {
      if (part.kind !== "subagent" || part.status !== "running" || !isRecord(part.metadata)) {
        return part;
      }
      const agentId = readStringProp(part.metadata, "agentId");
      const status = agentId ? terminalStatuses.get(agentId) : undefined;
      return status ? { ...part, status } : part;
    });
  }
};

const claudeSessionMessages = (messages: readonly ClaudeHistoryMessage[]): SessionMessage[] =>
  messages.filter(
    (message): message is SessionMessage =>
      (message.type === "assistant" || message.type === "user" || message.type === "system") &&
      "message" in message,
  );

export const finalizeClaudeHistory = (
  input: LoadAgentSessionHistoryInput,
  history: AgentSessionHistoryMessage[],
): AgentSessionHistoryMessage[] => {
  const limitedHistory = history.slice(input.limit ? -input.limit : undefined);
  const systemPromptContext = input.systemPromptContext;
  const systemPrompt = systemPromptContext?.systemPrompt.trim() ?? "";
  if (!systemPromptContext || systemPrompt.length === 0) {
    return limitedHistory;
  }
  return [
    {
      messageId: `claude-system-prompt:${input.externalSessionId}`,
      role: "system",
      timestamp: systemPromptContext.startedAt,
      text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${systemPrompt}`,
      parts: [],
    },
    ...limitedHistory,
  ];
};

export const loadClaudeHistory = async (
  input: LoadAgentSessionHistoryInput,
  now: () => string,
  liveContext?: ClaudeLiveHistoryContext,
): Promise<AgentSessionHistoryMessage[]> => {
  if (liveContext?.source === "fresh" && liveContext.userMessages.length === 0) {
    return finalizeClaudeHistory(input, []);
  }
  const { messages, subagentAgentIdsByToolUseId } = await loadClaudeHistoryProjectionInput(input);
  const history = toClaudeHistoryMessages(messages, now, liveContext?.userMessages ?? [], {
    includeNestedEntries: isClaudeSubagentTranscriptTarget(input.externalSessionId),
    subagentAgentIdsByToolUseId,
    transcriptExternalSessionId: input.externalSessionId,
  });
  await reconcileClaudeSubagentStatuses(input, history, claudeSessionMessages(messages));
  return finalizeClaudeHistory(input, history);
};
