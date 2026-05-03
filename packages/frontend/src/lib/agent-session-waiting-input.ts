import type { AgentSessionState } from "@/types/agent-orchestrator";

const pendingInputNoun = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

export const isAgentSessionWaitingInput = (
  session: Pick<AgentSessionState, "pendingApprovals" | "pendingQuestions">,
): boolean => session.pendingApprovals.length > 0 || session.pendingQuestions.length > 0;

export const getAgentSessionWaitingInputPlaceholder = (
  session: Pick<AgentSessionState, "pendingApprovals" | "pendingQuestions">,
): string | null => {
  const pendingQuestionCount = session.pendingQuestions.length;
  const pendingApprovalCount = session.pendingApprovals.length;

  if (pendingQuestionCount > 0 && pendingApprovalCount > 0) {
    return "Resolve the pending questions and approval requests above to continue";
  }

  if (pendingQuestionCount > 0) {
    return `Answer the pending ${pendingInputNoun(pendingQuestionCount, "question", "questions")} above to continue`;
  }

  if (pendingApprovalCount > 0) {
    return `Respond to the pending ${pendingInputNoun(
      pendingApprovalCount,
      "approval request",
      "approval requests",
    )} above to continue`;
  }

  return null;
};
