import { memo, type ReactElement } from "react";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import {
  type AgentChatThreadMotionRowProps,
  type AgentChatTurnGroupProps,
  areAgentChatThreadMotionRowPropsEqual,
  areAgentChatTurnGroupPropsEqual,
  isAgentChatTurnRowStreamingAssistant,
  readSubagentPendingApprovalCount,
  readSubagentPendingQuestionCount,
} from "./agent-chat-turn-group-comparator";

export type { AgentChatTurnGroupProps } from "./agent-chat-turn-group-comparator";

const TURN_CONTENT_VISIBILITY_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 500px",
} as const;

const AgentChatThreadMotionRow = memo(function AgentChatThreadMotionRow({
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
}, areAgentChatThreadMotionRowPropsEqual);

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
          isStreamingAssistantMessage={isAgentChatTurnRowStreamingAssistant(
            row,
            turn.activeStreamingAssistantMessageId,
          )}
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
