import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentSessionHistoryMessage,
} from "@openducktor/core";

/** The instructions of a session and the time when they applied. */
export type SystemPromptHistoryContext = {
  readonly systemPrompt: string;
  readonly startedAt: string;
};

/**
 * Shows the initial system instructions of a session once, before its first history message. A
 * session with no instructions keeps its history as it is.
 */
export const withSystemPromptHistoryMessage = (
  messageId: string,
  context: SystemPromptHistoryContext | undefined,
  history: AgentSessionHistoryMessage[],
): AgentSessionHistoryMessage[] => {
  const systemPrompt = context?.systemPrompt.trim() ?? "";
  if (!context || systemPrompt.length === 0) return history;
  return [
    {
      messageId,
      role: "system",
      timestamp: context.startedAt,
      text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${systemPrompt}`,
      parts: [],
    },
    ...history,
  ];
};

/** The last `limit` entries of a history, or all of them with no limit. */
export const historyTail = <Entry>(history: readonly Entry[], limit: number | undefined): Entry[] =>
  history.slice(limit ? -limit : undefined);
