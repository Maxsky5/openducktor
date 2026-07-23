import type { AgentEvent } from "@openducktor/core";
import type { ClaudeManualCompactionState } from "./claude-agent-sdk-types";

export const CLAUDE_COMPACTION_STARTED_MESSAGE = "Session compaction started.";
export const CLAUDE_COMPACTED_MESSAGE = "Session compacted.";

type ClaudeCompactionSession = {
  activeManualCompaction?: ClaudeManualCompactionState;
  externalSessionId: string;
};

type EmitClaudeCompactionEvent = (event: AgentEvent) => void;

export const beginClaudeManualCompaction = ({
  emit,
  messageId,
  session,
  timestamp,
}: {
  emit: EmitClaudeCompactionEvent;
  messageId: string;
  session: ClaudeCompactionSession;
  timestamp: string;
}): void => {
  session.activeManualCompaction = { messageId, boundaryReceived: false };
  emit({
    type: "session_compaction_started",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId,
    message: CLAUDE_COMPACTION_STARTED_MESSAGE,
  });
};

export const handleClaudeCompactionBoundary = ({
  boundaryMessageId,
  emit,
  session,
  timestamp,
}: {
  boundaryMessageId: string;
  emit: EmitClaudeCompactionEvent;
  session: ClaudeCompactionSession;
  timestamp: string;
}): void => {
  const activeCompaction = session.activeManualCompaction;
  if (activeCompaction) {
    activeCompaction.boundaryReceived = true;
  }
  emit({
    type: "session_compacted",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId: activeCompaction?.messageId ?? boundaryMessageId,
    message: CLAUDE_COMPACTED_MESSAGE,
  });
};

export const settleClaudeManualCompactionResult = ({
  emit,
  result,
  session,
  timestamp,
}: {
  emit: EmitClaudeCompactionEvent;
  result: string;
  session: ClaudeCompactionSession;
  timestamp: string;
}): boolean => {
  const activeCompaction = session.activeManualCompaction;
  if (!activeCompaction) {
    return false;
  }
  if (!activeCompaction.boundaryReceived) {
    emit({
      type: "session_compacted",
      externalSessionId: session.externalSessionId,
      timestamp,
      messageId: activeCompaction.messageId,
      message: result || "No session compaction was needed.",
    });
  }
  delete session.activeManualCompaction;
  return true;
};

export const clearClaudeManualCompaction = (session: ClaudeCompactionSession): void => {
  delete session.activeManualCompaction;
};
