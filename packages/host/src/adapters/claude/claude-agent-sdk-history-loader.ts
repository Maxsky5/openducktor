import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentSessionHistoryMessage,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import {
  isClaudeSessionMissingError,
  loadClaudeSessionMessages,
} from "./claude-agent-sdk-history-messages";
import type { ClaudeLiveUserMessage } from "./claude-agent-sdk-history-support";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { hasActiveClaudeWork } from "./claude-agent-sdk-session-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";

export type ClaudeLiveHistoryContext = {
  activeBackgroundTaskIds: () => ReadonlySet<string>;
  hasActiveWork: () => boolean;
  source: "fresh" | "persisted";
  subagentAgentIdsByToolUseId?: ReadonlyMap<string, string>;
  userMessages: readonly ClaudeLiveUserMessage[];
};

/** A resumed or forked session must load its saved transcript. */
export const claudeLiveHistoryContext = (
  session: ClaudeSession,
  externalSessionId = session.externalSessionId,
): ClaudeLiveHistoryContext => {
  const isSubagent = isClaudeSubagentTranscriptTarget(externalSessionId);
  const work = isSubagent ? findClaudeHistoryWork(session, externalSessionId) : session;
  return {
    activeBackgroundTaskIds: () => {
      const ids = new Set<string>();
      const collect = (work: ClaudeEventSession): void => {
        for (const id of work.backgroundToolActiveTaskIds ?? []) ids.add(id);
        for (const child of work.subagentEventSessionsByToolUseId?.values() ?? []) collect(child);
      };
      const work = isSubagent ? findClaudeHistoryWork(session, externalSessionId) : session;
      if (work) collect(work);
      return ids;
    },
    hasActiveWork: () => hasActiveClaudeWork(session),
    source:
      isSubagent ||
      "externalSessionId" in session.input ||
      "parentExternalSessionId" in session.input
        ? "persisted"
        : "fresh",
    subagentAgentIdsByToolUseId: work?.subagentAgentIdsByToolUseId ?? new Map(),
    userMessages: isSubagent ? [] : [...session.acceptedUserMessages],
  };
};

const findClaudeHistoryWork = (
  session: ClaudeEventSession,
  externalSessionId: string,
): ClaudeEventSession | null => {
  if (session.externalSessionId === externalSessionId) return session;
  for (const child of session.subagentEventSessionsByToolUseId?.values() ?? []) {
    const match = findClaudeHistoryWork(child, externalSessionId);
    if (match) return match;
  }
  return null;
};

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
  const savedMessages = await loadClaudeSessionMessages(input).catch((cause: unknown) => {
    // The UI can read history after the first live message but before Claude writes the
    // transcript. In this gap, the fresh session and its live events hold the new messages.
    if (
      liveContext?.source !== "fresh" ||
      !liveContext.hasActiveWork() ||
      !isClaudeSessionMissingError(cause)
    ) {
      throw cause;
    }
    return null;
  });
  const messages = savedMessages ?? [];
  const isSubagentTranscript = isClaudeSubagentTranscriptTarget(input.externalSessionId);
  const projectionOptions: NonNullable<Parameters<typeof toClaudeHistoryMessages>[3]> = {
    includeNestedEntries: isSubagentTranscript,
    transcriptExternalSessionId: input.externalSessionId,
  };
  if (liveContext?.subagentAgentIdsByToolUseId) {
    projectionOptions.subagentAgentIdsByToolUseId = liveContext.subagentAgentIdsByToolUseId;
  }
  projectionOptions.currentBackgroundTaskIds = liveContext?.activeBackgroundTaskIds() ?? new Set();
  const history = toClaudeHistoryMessages(
    messages,
    now,
    liveContext?.userMessages ?? [],
    projectionOptions,
  );
  return finalizeClaudeHistory(input, history);
};
