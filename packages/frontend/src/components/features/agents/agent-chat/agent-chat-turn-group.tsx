import { memo, type ReactElement } from "react";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { getSubagentMessageSessionKey } from "./subagent-session-key";
import type { AgentChatRenderedTurn } from "./use-agent-chat-rendered-transcript";

type AgentChatThreadMotionRowProps = {
  row: AgentChatWindowRow;
  isStreamingAssistantMessage: boolean;
  sessionAgentColors: Record<string, string>;
  sessionIdentity: AgentSessionIdentity | null;
  subagentPendingApprovalCount: number;
  subagentPendingQuestionCount: number;
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
};

export type AgentChatTurnGroupProps = {
  turn: AgentChatRenderedTurn;
  sessionAgentColors: Record<string, string>;
  sessionIdentity: AgentSessionIdentity | null;
  subagentPendingApprovalCountBySessionKey: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"];
  subagentPendingQuestionCountBySessionKey: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"];
  resolveRowRef: (rowKey: string) => (element: HTMLDivElement | null) => void;
  allowTurnContainment: boolean;
};

const TURN_CONTENT_VISIBILITY_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 500px",
} as const;

export const areChatRowsEquivalent = (
  left: AgentChatWindowRow,
  right: AgentChatWindowRow,
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

const readSubagentPendingApprovalCount = (
  row: AgentChatWindowRow,
  countsBySessionKey: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"],
  sessionIdentity: AgentSessionIdentity | null,
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

const readSubagentPendingQuestionCount = (
  row: AgentChatWindowRow,
  countsBySessionKey: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"],
  sessionIdentity: AgentSessionIdentity | null,
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
  previousRows: AgentChatWindowRow[],
  nextRows: AgentChatWindowRow[],
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
  rows: AgentChatWindowRow[];
  previousApprovalCounts: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"];
  nextApprovalCounts: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"];
  previousQuestionCounts: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"];
  nextQuestionCounts: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"];
  sessionIdentity: AgentSessionIdentity | null;
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
    previousProps.sessionAgentColors === nextProps.sessionAgentColors &&
    previousProps.sessionIdentity === nextProps.sessionIdentity &&
    previousProps.resolveRowRef === nextProps.resolveRowRef &&
    previousProps.allowTurnContainment === nextProps.allowTurnContainment &&
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

const AgentChatThreadMotionRow = memo(
  function AgentChatThreadMotionRow({
    row,
    isStreamingAssistantMessage,
    sessionAgentColors,
    sessionIdentity,
    subagentPendingApprovalCount,
    subagentPendingQuestionCount,
    resolveRowRef,
  }: AgentChatThreadMotionRowProps): ReactElement {
    return (
      <div ref={resolveRowRef(row.key)} data-row-key={row.key} className="agent-chat-row-motion">
        <AgentChatThreadRow
          row={row}
          isStreamingAssistantMessage={isStreamingAssistantMessage}
          sessionAgentColors={sessionAgentColors}
          sessionIdentity={sessionIdentity}
          subagentPendingApprovalCount={subagentPendingApprovalCount}
          subagentPendingQuestionCount={subagentPendingQuestionCount}
        />
      </div>
    );
  },
  (previousProps, nextProps) => {
    return (
      previousProps.sessionIdentity === nextProps.sessionIdentity &&
      previousProps.subagentPendingApprovalCount === nextProps.subagentPendingApprovalCount &&
      previousProps.subagentPendingQuestionCount === nextProps.subagentPendingQuestionCount &&
      previousProps.isStreamingAssistantMessage === nextProps.isStreamingAssistantMessage &&
      previousProps.sessionAgentColors === nextProps.sessionAgentColors &&
      previousProps.resolveRowRef === nextProps.resolveRowRef &&
      areChatRowsEquivalent(previousProps.row, nextProps.row)
    );
  },
);

export const AgentChatTurnGroup = memo(function AgentChatTurnGroup({
  turn,
  sessionAgentColors,
  sessionIdentity,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
  resolveRowRef,
  allowTurnContainment,
}: AgentChatTurnGroupProps): ReactElement {
  return (
    <div style={!allowTurnContainment || turn.isActive ? undefined : TURN_CONTENT_VISIBILITY_STYLE}>
      {turn.rows.map((row) => (
        <AgentChatThreadMotionRow
          key={row.key}
          row={row}
          isStreamingAssistantMessage={
            row.kind === "message" && row.message.id === turn.activeStreamingAssistantMessageId
          }
          sessionAgentColors={sessionAgentColors}
          sessionIdentity={sessionIdentity}
          subagentPendingApprovalCount={readSubagentPendingApprovalCount(
            row,
            subagentPendingApprovalCountBySessionKey,
            sessionIdentity,
          )}
          subagentPendingQuestionCount={readSubagentPendingQuestionCount(
            row,
            subagentPendingQuestionCountBySessionKey,
            sessionIdentity,
          )}
          resolveRowRef={resolveRowRef}
        />
      ))}
    </div>
  );
}, areAgentChatTurnGroupPropsEqual);
