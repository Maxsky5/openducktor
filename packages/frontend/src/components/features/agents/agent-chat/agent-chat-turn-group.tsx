import { memo, type ReactElement } from "react";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import { ToolRunGroup } from "./agent-chat-tool-run";
import {
  type AgentChatTurnRowProps,
  type AgentChatTurnGroupProps,
  areAgentChatTurnRowPropsEqual,
  areAgentChatTurnGroupPropsEqual,
  isAgentChatTurnRowStreamingAssistant,
  readSubagentPendingApprovalCount,
  readSubagentPendingQuestionCount,
} from "./agent-chat-turn-group-comparator";

export type { AgentChatTurnGroupProps } from "./agent-chat-turn-group-comparator";

const AgentChatTurnRow = memo(function AgentChatTurnRow({
  row,
  modelCatalog = null,
  isStreamingAssistantMessage,
  sessionIdentity,
  runtimePresentation,
  subagentPendingApprovalCount,
  subagentPendingQuestionCount,
}: AgentChatTurnRowProps): ReactElement {
  return (
    <div data-row-key={row.key} className="agent-chat-row-motion">
      <AgentChatThreadRow
        row={row}
        modelCatalog={modelCatalog}
        isStreamingAssistantMessage={isStreamingAssistantMessage}
        sessionIdentity={sessionIdentity}
        runtimePresentation={runtimePresentation}
        subagentPendingApprovalCount={subagentPendingApprovalCount}
        subagentPendingQuestionCount={subagentPendingQuestionCount}
      />
    </div>
  );
}, areAgentChatTurnRowPropsEqual);

export const AgentChatTurnGroup = memo(function AgentChatTurnGroup({
  turn,
  modelCatalog = null,
  transcriptTarget,
  runtimePresentation,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
}: AgentChatTurnGroupProps): ReactElement {
  return (
    <div>
      {turn.items.map((item) =>
        item.kind === "tool_run" ? (
          <ToolRunGroup
            key={item.key}
            item={item}
            runtimePresentation={runtimePresentation}
            workingDirectory={transcriptTarget?.workingDirectory ?? null}
          />
        ) : (
          <AgentChatTurnRow
            key={item.key}
            row={item.row}
            modelCatalog={modelCatalog}
            isStreamingAssistantMessage={isAgentChatTurnRowStreamingAssistant(
              item.row,
              turn.activeStreamingAssistantMessageId,
            )}
            sessionIdentity={transcriptTarget}
            runtimePresentation={runtimePresentation}
            subagentPendingApprovalCount={readSubagentPendingApprovalCount(
              item.row,
              subagentPendingApprovalCountBySessionKey,
              transcriptTarget,
            )}
            subagentPendingQuestionCount={readSubagentPendingQuestionCount(
              item.row,
              subagentPendingQuestionCountBySessionKey,
              transcriptTarget,
            )}
          />
        ),
      )}
    </div>
  );
}, areAgentChatTurnGroupPropsEqual);
