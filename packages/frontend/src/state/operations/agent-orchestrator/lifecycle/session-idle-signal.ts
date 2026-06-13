import type { AgentSessionState } from "@/types/agent-orchestrator";

export const shouldHoldSessionOnIdleSignal = (session: AgentSessionState): boolean => {
  if (session.status === "starting") {
    return true;
  }

  return (
    session.status === "running" &&
    session.pendingUserMessageStartedAt !== undefined &&
    session.draftAssistantText.trim().length === 0 &&
    session.draftReasoningText.trim().length === 0 &&
    session.pendingApprovals.length === 0 &&
    session.pendingQuestions.length === 0
  );
};

export const settleLiveTurnFields = (): Pick<
  AgentSessionState,
  | "pendingUserMessageStartedAt"
  | "draftAssistantText"
  | "draftAssistantMessageId"
  | "draftReasoningText"
  | "draftReasoningMessageId"
> => ({
  pendingUserMessageStartedAt: undefined,
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
});

export const statusWithoutRuntimePresence = (
  current: AgentSessionState,
): AgentSessionState["status"] => {
  if (current.status === "error" || current.status === "stopped") {
    return current.status;
  }
  return "idle";
};
