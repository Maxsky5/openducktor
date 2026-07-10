import type {
  AgentSessionHistoryMessage,
  AgentSkillReference,
  LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { loadClaudeRawHistoryMessages } from "./claude-agent-sdk-history-import";
import type { ClaudeLiveUserMessage } from "./claude-agent-sdk-history-support";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";

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
  return history.slice(input.limit ? -input.limit : undefined);
};
