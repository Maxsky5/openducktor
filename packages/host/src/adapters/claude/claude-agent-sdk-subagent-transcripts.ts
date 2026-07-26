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
  return {
    sessionId,
    subpath: taskIds.map(claudeSubagentSubpath).join("/"),
  };
};

export const isClaudeSubagentTranscriptTarget = (externalSessionId: string): boolean =>
  parseClaudeTranscriptTarget(externalSessionId).subpath !== undefined;
