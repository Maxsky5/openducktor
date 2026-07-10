import type { AgentEvent } from "@openducktor/core";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";

type ClaudePendingInputEvent = Extract<
  AgentEvent,
  {
    type: "approval_required" | "approval_resolved" | "question_required" | "question_resolved";
  }
>;

export const claudeSubagentPendingInputRoute = (
  parentExternalSessionId: string,
  agentId: string | undefined,
) => {
  if (!agentId) {
    return {};
  }
  return {
    parentExternalSessionId,
    childExternalSessionId: claudeSubagentExternalSessionId(parentExternalSessionId, agentId),
    subagentCorrelationKey: agentId,
  };
};

export const emitClaudePendingInputEvent = <Session extends ClaudeSessionContext>({
  emit,
  event,
  session,
}: {
  emit: (session: Session, event: AgentEvent) => void;
  event: ClaudePendingInputEvent;
  session: Session;
}): void => {
  emit(
    session,
    event.childExternalSessionId && event.childExternalSessionId !== event.externalSessionId
      ? { ...event, externalSessionId: event.childExternalSessionId }
      : event,
  );
};

export const claudePendingInputResolutionRoute = (
  event: Extract<AgentEvent, { type: "approval_required" | "question_required" }>,
) => ({
  ...(event.parentExternalSessionId
    ? { parentExternalSessionId: event.parentExternalSessionId }
    : {}),
  ...(event.childExternalSessionId ? { childExternalSessionId: event.childExternalSessionId } : {}),
  ...(event.subagentCorrelationKey ? { subagentCorrelationKey: event.subagentCorrelationKey } : {}),
});
