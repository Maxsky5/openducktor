import type { AgentSessionState } from "@/types/agent-orchestrator";
import { findLastSessionMessageByRole, upsertSessionMessage } from "../support/messages";
import { formatSubagentContent } from "../support/subagent-messages";
import { normalizeSessionId, readSessionInEventRuntime } from "./session-event-sessions";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";

type ApprovalRequiredEvent = Extract<SessionEvent, { type: "approval_required" }>;
type QuestionRequiredEvent = Extract<SessionEvent, { type: "question_required" }>;
type SubagentLinkEvent = ApprovalRequiredEvent | QuestionRequiredEvent;

const resolveSubagentMessageForSessionLink = (
  current: AgentSessionState,
  event: SubagentLinkEvent,
) => {
  if (!event.subagentCorrelationKey) {
    return undefined;
  }

  return findLastSessionMessageByRole(
    current,
    "system",
    (message) =>
      message.meta?.kind === "subagent" &&
      message.meta.correlationKey === event.subagentCorrelationKey,
  );
};

export const patchParentSubagentSessionLink = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: SubagentLinkEvent,
): void => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!event.parentExternalSessionId || !childExternalSessionId) {
    return;
  }
  const parentSession = readSessionInEventRuntime(context, event.parentExternalSessionId);
  if (!parentSession) {
    return;
  }

  context.store.updateSession(
    parentSession,
    (current) => {
      const subagentMessage = resolveSubagentMessageForSessionLink(current, event);
      if (subagentMessage?.meta?.kind !== "subagent") {
        return current;
      }
      if (subagentMessage.meta.externalSessionId === childExternalSessionId) {
        return current;
      }

      const nextMeta = {
        ...subagentMessage.meta,
        externalSessionId: childExternalSessionId,
      };
      return {
        ...current,
        messages: upsertSessionMessage(current, {
          ...subagentMessage,
          content: formatSubagentContent(nextMeta),
          meta: nextMeta,
        }),
      };
    },
    { persist: false },
  );
};
