import type { AgentChatThreadModel } from "./agent-chat.types";
import { isAssistantMessageStreaming } from "./agent-chat-streaming";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";
import { getSubagentMessageSessionKey } from "./subagent-session-key";
import type { AgentChatRenderedTurn } from "./use-agent-chat-rendered-transcript";

export type AgentChatThreadMotionRowProps = {
  row: AgentChatTranscriptRow;
  isStreamingAssistantMessage: boolean;
  sessionAgentColors: Record<string, string>;
  sessionIdentity: AgentSessionTranscriptTarget | null;
  subagentPendingApprovalCount: number;
  subagentPendingQuestionCount: number;
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
};

export type AgentChatTurnGroupProps = {
  turn: AgentChatRenderedTurn;
  sessionAgentColors: Record<string, string>;
  sessionIdentity: AgentSessionTranscriptTarget | null;
  subagentPendingApprovalCountBySessionKey: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"];
  subagentPendingQuestionCountBySessionKey: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"];
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
};

export const areAgentColorsEqual = (
  left: Record<string, string>,
  right: Record<string, string>,
): boolean => {
  if (left === right) {
    return true;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
};

export const areAgentSessionTranscriptTargetsEqual = (
  left: AgentSessionTranscriptTarget | null,
  right: AgentSessionTranscriptTarget | null,
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.externalSessionId === right.externalSessionId &&
    left.runtimeKind === right.runtimeKind &&
    left.workingDirectory === right.workingDirectory &&
    (left.sessionScope?.taskId ?? null) === (right.sessionScope?.taskId ?? null) &&
    (left.sessionScope?.role ?? null) === (right.sessionScope?.role ?? null)
  );
};

export const isAgentChatTurnRowStreamingAssistant = (
  row: AgentChatTranscriptRow,
  activeStreamingAssistantMessageId: string | null,
): boolean =>
  row.kind === "message" &&
  row.message.id === activeStreamingAssistantMessageId &&
  isAssistantMessageStreaming(row.message);

export const areChatRowsEquivalent = (
  left: AgentChatTranscriptRow,
  right: AgentChatTranscriptRow,
): boolean => {
  if (left === right) {
    return true;
  }
  if (left.kind !== right.kind || left.key !== right.key) {
    return false;
  }
  if (left.kind === "turn_duration" && right.kind === "turn_duration") {
    return left.durationMs === right.durationMs;
  }
  return left.kind === "message" && right.kind === "message" && left.message === right.message;
};

export const readSubagentPendingApprovalCount = (
  row: AgentChatTranscriptRow,
  countsBySessionKey: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"],
  sessionIdentity: AgentSessionTranscriptTarget | null,
): number => {
  if (row.kind !== "message") {
    return 0;
  }

  const sessionKey = getSubagentMessageSessionKey({
    message: row.message,
    parentSession: sessionIdentity,
  });
  return sessionKey ? (countsBySessionKey?.[sessionKey] ?? 0) : 0;
};

export const readSubagentPendingQuestionCount = (
  row: AgentChatTranscriptRow,
  countsBySessionKey: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"],
  sessionIdentity: AgentSessionTranscriptTarget | null,
): number => {
  if (row.kind !== "message") {
    return 0;
  }

  const sessionKey = getSubagentMessageSessionKey({
    message: row.message,
    parentSession: sessionIdentity,
  });
  return sessionKey ? (countsBySessionKey?.[sessionKey] ?? 0) : 0;
};

const areTurnRowsEquivalent = (
  previousRows: AgentChatTranscriptRow[],
  nextRows: AgentChatTranscriptRow[],
): boolean => {
  if (previousRows.length !== nextRows.length) {
    return false;
  }

  for (let index = 0; index < previousRows.length; index += 1) {
    const row = previousRows[index];
    const nextRow = nextRows[index];
    if (!row || !nextRow || !areChatRowsEquivalent(row, nextRow)) {
      return false;
    }
  }

  return true;
};

const areTurnSubagentPendingCountsEquivalent = ({
  rows,
  previousApprovalCounts,
  nextApprovalCounts,
  previousQuestionCounts,
  nextQuestionCounts,
  sessionIdentity,
}: {
  rows: AgentChatTranscriptRow[];
  previousApprovalCounts: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"];
  nextApprovalCounts: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"];
  previousQuestionCounts: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"];
  nextQuestionCounts: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"];
  sessionIdentity: AgentSessionTranscriptTarget | null;
}): boolean => {
  if (
    previousApprovalCounts === nextApprovalCounts &&
    previousQuestionCounts === nextQuestionCounts
  ) {
    return true;
  }

  for (const row of rows) {
    if (
      readSubagentPendingApprovalCount(row, previousApprovalCounts, sessionIdentity) ===
        readSubagentPendingApprovalCount(row, nextApprovalCounts, sessionIdentity) &&
      readSubagentPendingQuestionCount(row, previousQuestionCounts, sessionIdentity) ===
        readSubagentPendingQuestionCount(row, nextQuestionCounts, sessionIdentity)
    ) {
      continue;
    }

    return false;
  }

  return true;
};

export const areAgentChatThreadMotionRowPropsEqual = (
  previousProps: AgentChatThreadMotionRowProps,
  nextProps: AgentChatThreadMotionRowProps,
): boolean => {
  return (
    areAgentSessionTranscriptTargetsEqual(
      previousProps.sessionIdentity,
      nextProps.sessionIdentity,
    ) &&
    previousProps.subagentPendingApprovalCount === nextProps.subagentPendingApprovalCount &&
    previousProps.subagentPendingQuestionCount === nextProps.subagentPendingQuestionCount &&
    previousProps.isStreamingAssistantMessage === nextProps.isStreamingAssistantMessage &&
    areAgentColorsEqual(previousProps.sessionAgentColors, nextProps.sessionAgentColors) &&
    previousProps.resolveRowRef === nextProps.resolveRowRef &&
    areChatRowsEquivalent(previousProps.row, nextProps.row)
  );
};

export const areAgentChatTurnGroupPropsEqual = (
  previousProps: AgentChatTurnGroupProps,
  nextProps: AgentChatTurnGroupProps,
): boolean => {
  // Pending input maps can be rebuilt as active sessions stream. Compare the counts that affect
  // this turn instead of invalidating every visible subagent row on map identity alone.
  return (
    previousProps.turn.key === nextProps.turn.key &&
    previousProps.turn.isActive === nextProps.turn.isActive &&
    previousProps.turn.activeStreamingAssistantMessageId ===
      nextProps.turn.activeStreamingAssistantMessageId &&
    areAgentColorsEqual(previousProps.sessionAgentColors, nextProps.sessionAgentColors) &&
    areAgentSessionTranscriptTargetsEqual(
      previousProps.sessionIdentity,
      nextProps.sessionIdentity,
    ) &&
    previousProps.resolveRowRef === nextProps.resolveRowRef &&
    areTurnRowsEquivalent(previousProps.turn.rows, nextProps.turn.rows) &&
    areTurnSubagentPendingCountsEquivalent({
      rows: nextProps.turn.rows,
      previousApprovalCounts: previousProps.subagentPendingApprovalCountBySessionKey,
      nextApprovalCounts: nextProps.subagentPendingApprovalCountBySessionKey,
      previousQuestionCounts: previousProps.subagentPendingQuestionCountBySessionKey,
      nextQuestionCounts: nextProps.subagentPendingQuestionCountBySessionKey,
      sessionIdentity: nextProps.sessionIdentity,
    })
  );
};
