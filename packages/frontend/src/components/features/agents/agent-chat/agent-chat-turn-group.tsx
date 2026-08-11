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

const AgentChatThreadMotionRow = memo(function AgentChatThreadMotionRow({
  row,
  modelCatalog = null,
  isStreamingAssistantMessage,
  sessionAgentColors,
  sessionIdentity,
  runtimePresentation,
  subagentPendingApprovalCount,
  subagentPendingQuestionCount,
  resolveRowRef,
}: AgentChatThreadMotionRowProps): ReactElement {
  return (
    <div ref={resolveRowRef(row.key)} data-row-key={row.key} className="agent-chat-row-motion">
      <AgentChatThreadRow
        row={row}
        modelCatalog={modelCatalog}
        isStreamingAssistantMessage={isStreamingAssistantMessage}
        sessionAgentColors={sessionAgentColors}
        sessionIdentity={sessionIdentity}
        runtimePresentation={runtimePresentation}
        subagentPendingApprovalCount={subagentPendingApprovalCount}
        subagentPendingQuestionCount={subagentPendingQuestionCount}
      />
    </div>
  );
}, areAgentChatThreadMotionRowPropsEqual);

export const AgentChatTurnGroup = memo(function AgentChatTurnGroup({
  turn,
  modelCatalog = null,
  sessionAgentColors,
  transcriptTarget,
  runtimePresentation,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
  resolveRowRef,
}: AgentChatTurnGroupProps): ReactElement {
  return (
    <div>
      {turn.rows.map((row) => (
        <AgentChatThreadMotionRow
          key={row.key}
          row={row}
          modelCatalog={modelCatalog}
          isStreamingAssistantMessage={isAgentChatTurnRowStreamingAssistant(
            row,
            turn.activeStreamingAssistantMessageId,
          )}
          sessionAgentColors={sessionAgentColors}
          sessionIdentity={transcriptTarget}
          runtimePresentation={runtimePresentation}
          subagentPendingApprovalCount={readSubagentPendingApprovalCount(
            row,
            subagentPendingApprovalCountBySessionKey,
            transcriptTarget,
          )}
          subagentPendingQuestionCount={readSubagentPendingQuestionCount(
            row,
            subagentPendingQuestionCountBySessionKey,
            transcriptTarget,
          )}
          resolveRowRef={resolveRowRef}
        />
      ))}
    </div>
  );
}, areAgentChatTurnGroupPropsEqual);
