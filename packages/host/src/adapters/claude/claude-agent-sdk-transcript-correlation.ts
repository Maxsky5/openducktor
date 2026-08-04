export type ClaudeTranscriptCorrelationState = {
  hiddenSubagentTaskIds?: Set<string>;
  retractedSubagentTaskIds?: Set<string>;
  retractedToolUseIds?: Set<string>;
  subagentEventSessionsByToolUseId?: Map<string, unknown>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  toolEndedAtMsByCallId?: Map<string, number>;
  toolInputsByCallId?: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolStartedAtMsByCallId?: Map<string, number>;
};

export const isClaudeToolUseRetracted = (
  state: Pick<ClaudeTranscriptCorrelationState, "retractedToolUseIds">,
  toolUseId: string,
): boolean => state.retractedToolUseIds?.has(toolUseId) ?? false;

export const isClaudeSubagentTaskRetracted = (
  state: Pick<ClaudeTranscriptCorrelationState, "retractedSubagentTaskIds">,
  taskId: string,
): boolean => state.retractedSubagentTaskIds?.has(taskId) ?? false;

export const retireClaudeSubagentTask = (
  state: Pick<ClaudeTranscriptCorrelationState, "retractedSubagentTaskIds">,
  taskId: string,
): void => {
  state.retractedSubagentTaskIds ??= new Set();
  state.retractedSubagentTaskIds.add(taskId);
};

export const retractClaudeTranscriptCorrelations = (
  state: ClaudeTranscriptCorrelationState,
  messageIds: readonly string[],
): { toolUseIds: string[] } => {
  const retractedMessageIds = new Set(messageIds);
  const toolUseIds = new Set<string>();
  for (const [toolUseId, messageId] of state.toolMessageIdsByCallId) {
    if (retractedMessageIds.has(messageId)) {
      toolUseIds.add(toolUseId);
    }
  }
  const subagentTaskIds = new Set<string>();
  for (const [taskId, messageId] of state.subagentMessageIdsByTaskId) {
    if (retractedMessageIds.has(messageId)) {
      subagentTaskIds.add(taskId);
    }
  }

  for (const [toolUseId, taskId] of state.subagentTaskIdsByToolUseId) {
    if (toolUseIds.has(toolUseId)) {
      subagentTaskIds.add(taskId);
    }
  }
  for (const [toolUseId, taskId] of state.subagentTaskIdsByToolUseId) {
    if (subagentTaskIds.has(taskId)) {
      toolUseIds.add(toolUseId);
    }
  }

  state.retractedToolUseIds ??= new Set();
  for (const toolUseId of toolUseIds) {
    state.retractedToolUseIds.add(toolUseId);
    state.toolEndedAtMsByCallId?.delete(toolUseId);
    state.toolInputsByCallId?.delete(toolUseId);
    state.toolMessageIdsByCallId.delete(toolUseId);
    state.toolNamesByCallId.delete(toolUseId);
    state.toolStartedAtMsByCallId?.delete(toolUseId);
    state.subagentTaskIdsByToolUseId.delete(toolUseId);
    state.subagentEventSessionsByToolUseId?.delete(toolUseId);
  }

  state.retractedSubagentTaskIds ??= new Set();
  for (const taskId of subagentTaskIds) {
    state.retractedSubagentTaskIds.add(taskId);
    state.subagentMessageIdsByTaskId.delete(taskId);
    state.hiddenSubagentTaskIds?.delete(taskId);
  }

  return {
    toolUseIds: [...toolUseIds],
  };
};
