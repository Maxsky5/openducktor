import { getSubagentMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentSessionHistoryMessage,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { z } from "zod";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { isLiveFinalAssistantStopReason } from "./claude-agent-sdk-history-assistant";
import {
  type ClaudeHistoryMessage,
  isClaudeSessionMissingError,
  loadClaudeHistoryProjectionInput,
} from "./claude-agent-sdk-history-import";
import type { ClaudeLiveUserMessage } from "./claude-agent-sdk-history-support";
import {
  claudeSubagentAgentId,
  isClaudeSubagentTranscriptTarget,
  parseClaudeTranscriptTarget,
} from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeBackgroundWorkSession } from "./claude-agent-sdk-event-session";
import { hasActiveClaudeWork } from "./claude-agent-sdk-session-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { readStringProp } from "./claude-agent-sdk-utils";

const claudeSubagentAssistantMessageSchema = z.looseObject({
  content: z
    .array(
      z.looseObject({
        text: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  stop_reason: z.string().nullable().optional(),
});

export type ClaudeLiveHistoryContext = {
  activeBackgroundTaskIds: () => ReadonlySet<string>;
  hasActiveWork: () => boolean;
  source: "fresh" | "persisted";
  userMessages: readonly ClaudeLiveUserMessage[];
};

/** A resumed or forked session must load its saved transcript. */
export const claudeLiveHistoryContext = (
  session: ClaudeSession,
  externalSessionId = session.externalSessionId,
): ClaudeLiveHistoryContext => {
  const isSubagent = isClaudeSubagentTranscriptTarget(externalSessionId);
  return {
    activeBackgroundTaskIds: () => {
      const ids = new Set<string>();
      const collect = (work: ClaudeBackgroundWorkSession): void => {
        for (const id of work.backgroundToolActiveTaskIds ?? []) ids.add(id);
        for (const child of work.subagentEventSessionsByToolUseId?.values() ?? []) collect(child);
      };
      collect(session);
      return ids;
    },
    hasActiveWork: () => hasActiveClaudeWork(session),
    source:
      isSubagent ||
      "externalSessionId" in session.input ||
      "parentExternalSessionId" in session.input
        ? "persisted"
        : "fresh",
    userMessages: isSubagent
      ? []
      : session.acceptedUserMessages.map((message) => ({
          ...message,
          state: session.queuedSdkMessages.some(
            (queuedMessage) => queuedMessage.uuid === message.messageId,
          )
            ? ("queued" as const)
            : ("read" as const),
        })),
  };
};

export const isClaudeSubagentTranscriptComplete = (
  messages: readonly SessionMessage[],
): boolean => {
  const lastMessage = messages.at(-1);
  if (lastMessage?.type !== "assistant") {
    return false;
  }
  const assistantMessage = claudeSubagentAssistantMessageSchema.safeParse(lastMessage.message);
  return (
    assistantMessage.success &&
    isLiveFinalAssistantStopReason(assistantMessage.data.stop_reason ?? undefined)
  );
};

const hasClaudeSubagentFinalText = (messages: readonly SessionMessage[]): boolean => {
  const lastMessage = messages.at(-1);
  if (lastMessage?.type !== "assistant") {
    return false;
  }
  const assistantMessage = claudeSubagentAssistantMessageSchema.safeParse(lastMessage.message);
  if (!assistantMessage.success) {
    return false;
  }
  const content = assistantMessage.data.content;
  return content?.some((block) => block.type === "text" && Boolean(block.text?.trim())) === true;
};

export const reconciledClaudeSubagentStatus = (
  parentMessages: readonly SessionMessage[],
  childMessages: readonly SessionMessage[],
  executionMode?: "background" | "foreground",
): "cancelled" | "completed" | null => {
  if (isClaudeSubagentTranscriptComplete(childMessages)) {
    return "completed";
  }
  if (executionMode === "background") {
    return null;
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
  const latestStatusBySessionId = new Map<
    string,
    {
      agentId?: string;
      executionMode?: "background" | "foreground";
      status: string;
    }
  >();
  for (const message of history) {
    for (const part of message.parts) {
      if (part.kind !== "subagent" || !part.externalSessionId) {
        continue;
      }
      const previous = latestStatusBySessionId.get(part.externalSessionId);
      const agentId = part.metadata ? readStringProp(part.metadata, "agentId") : undefined;
      const resolvedAgentId = agentId ?? previous?.agentId;
      const latestStatus: NonNullable<ReturnType<typeof latestStatusBySessionId.get>> = {
        status: part.status,
      };
      if (resolvedAgentId) {
        latestStatus.agentId = resolvedAgentId;
      }
      if (part.executionMode) {
        latestStatus.executionMode = part.executionMode;
      }
      latestStatusBySessionId.set(part.externalSessionId, latestStatus);
    }
  }
  const runningAgents = [...latestStatusBySessionId.values()].flatMap(
    ({ agentId, executionMode, status }) =>
      status === "running" && agentId ? [{ agentId, executionMode }] : [],
  );
  if (runningAgents.length === 0) {
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
      runningAgents.map(async ({ agentId, executionMode }) => {
        const messages = await getSubagentMessages(target.sessionId, agentId, {
          dir: input.workingDirectory,
        });
        return [
          agentId,
          reconciledClaudeSubagentStatus(selectedAgentMessages, messages, executionMode),
        ] as const;
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
      if (part.kind !== "subagent" || part.status !== "running" || !part.metadata) {
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
  const projectionInput = await loadClaudeHistoryProjectionInput(input).catch((cause: unknown) => {
    // The UI can read history after the first live message but before Claude writes the
    // transcript. In this gap, the fresh session and its live events hold the new messages.
    if (
      liveContext?.source !== "fresh" ||
      !liveContext.hasActiveWork() ||
      !isClaudeSessionMissingError(cause)
    ) {
      throw cause;
    }
    return {
      messages: [],
      subagentAgentIdsByToolUseId: new Map<string, string>(),
    };
  });
  const { messages, subagentAgentIdsByToolUseId } = projectionInput;
  const isSubagentTranscript = isClaudeSubagentTranscriptTarget(input.externalSessionId);
  const projectionOptions: Parameters<typeof toClaudeHistoryMessages>[3] = {
    includeNestedEntries: isSubagentTranscript,
    subagentAgentIdsByToolUseId,
    transcriptExternalSessionId: input.externalSessionId,
  };
  projectionOptions.currentBackgroundTaskIds = liveContext?.activeBackgroundTaskIds() ?? new Set();
  const history = toClaudeHistoryMessages(
    messages,
    now,
    liveContext?.userMessages ?? [],
    projectionOptions,
  );
  await reconcileClaudeSubagentStatuses(input, history, claudeSessionMessages(messages));
  return finalizeClaudeHistory(input, history);
};
