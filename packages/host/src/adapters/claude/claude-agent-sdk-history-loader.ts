import type {
  AgentSessionHistoryMessage,
  AgentSkillReference,
  LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { AGENT_SESSION_SYSTEM_PROMPT_PREFIX } from "@openducktor/core";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { loadClaudeRawHistoryMessages } from "./claude-agent-sdk-history-import";
import type { ClaudeLiveUserMessage } from "./claude-agent-sdk-history-support";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";

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
  liveUserMessages: readonly ClaudeLiveUserMessage[] = [],
  loadSkills: () => Promise<readonly AgentSkillReference[]>,
): Promise<AgentSessionHistoryMessage[]> => {
  const [messages, skills] = await Promise.all([loadClaudeRawHistoryMessages(input), loadSkills()]);
  const history = toClaudeHistoryMessages(messages, now, liveUserMessages, {
    includeNestedEntries: isClaudeSubagentTranscriptTarget(input.externalSessionId),
    skills,
  });
  return finalizeClaudeHistory(input, history);
};
