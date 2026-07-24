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
  const separatorIndex = externalSessionId.indexOf(CLAUDE_SUBAGENT_TRANSCRIPT_SEPARATOR);
  if (separatorIndex === -1) {
    return { sessionId: externalSessionId };
  }
  const sessionId = externalSessionId.slice(0, separatorIndex);
  const taskId = externalSessionId.slice(
    separatorIndex + CLAUDE_SUBAGENT_TRANSCRIPT_SEPARATOR.length,
  );
  if (!sessionId || !taskId) {
    return { sessionId: externalSessionId };
  }
  return {
    sessionId,
    subpath: claudeSubagentSubpath(taskId),
  };
};

export const isClaudeSubagentTranscriptTarget = (externalSessionId: string): boolean =>
  parseClaudeTranscriptTarget(externalSessionId).subpath !== undefined;
