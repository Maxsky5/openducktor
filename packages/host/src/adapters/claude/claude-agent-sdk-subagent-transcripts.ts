const CLAUDE_SUBAGENT_TRANSCRIPT_SEPARATOR = "::claude-subagent::";

export type ClaudeTranscriptTarget = {
  sessionId: string;
  subpath?: string;
};

const claudeSubagentSubpath = (taskId: string): string => {
  const normalizedTaskId = taskId.startsWith("agent-") ? taskId : `agent-${taskId}`;
  return `subagents/${normalizedTaskId}`;
};

export const claudeSubagentExternalSessionId = (
  parentExternalSessionId: string,
  taskId: string,
): string => `${parentExternalSessionId}${CLAUDE_SUBAGENT_TRANSCRIPT_SEPARATOR}${taskId}`;

export const parseClaudeTranscriptTarget = (externalSessionId: string): ClaudeTranscriptTarget => {
  const [sessionId, ...taskIds] = externalSessionId.split(CLAUDE_SUBAGENT_TRANSCRIPT_SEPARATOR);
  if (taskIds.length === 0) {
    return { sessionId: externalSessionId };
  }
  if (!sessionId || taskIds.some((taskId) => !taskId)) {
    return { sessionId: externalSessionId };
  }
  // SAFETY: The runtime adapter builds this value from the contract fields required by `string`.
  return {
    sessionId,
    subpath: claudeSubagentSubpath(taskIds.at(-1) as string),
  };
};

export const isClaudeSubagentTranscriptTarget = (externalSessionId: string): boolean =>
  parseClaudeTranscriptTarget(externalSessionId).subpath !== undefined;

export const claudeSubagentAgentId = (externalSessionId: string): string | undefined => {
  const parts = externalSessionId.split(CLAUDE_SUBAGENT_TRANSCRIPT_SEPARATOR);
  if (parts.length < 2 || parts.some((part) => !part)) {
    return undefined;
  }
  return parts.at(-1);
};
