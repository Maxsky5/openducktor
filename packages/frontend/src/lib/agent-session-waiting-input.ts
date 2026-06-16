import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";

type AgentSessionPendingApprovals = {
  pendingApprovals: readonly AgentApprovalRequest[];
};

type AgentSessionPendingQuestions = {
  pendingQuestions: readonly AgentQuestionRequest[];
};

type AgentSessionPendingInput = AgentSessionPendingApprovals & AgentSessionPendingQuestions;

const pendingInputNoun = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

export const hasAgentSessionPendingApprovals = (session: AgentSessionPendingApprovals): boolean =>
  session.pendingApprovals.length > 0;

export const hasAgentSessionPendingQuestions = (session: AgentSessionPendingQuestions): boolean =>
  session.pendingQuestions.length > 0;

export const isAgentSessionWaitingInput = (session: AgentSessionPendingInput): boolean =>
  hasAgentSessionPendingApprovals(session) || hasAgentSessionPendingQuestions(session);

const getAgentSessionWaitingInputPlaceholderFromCounts = ({
  pendingApprovalCount,
  pendingQuestionCount,
}: {
  pendingApprovalCount: number;
  pendingQuestionCount: number;
}): string | null => {
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

export const getAgentSessionWaitingInputPlaceholder = (
  session: AgentSessionPendingInput,
): string | null =>
  getAgentSessionWaitingInputPlaceholderFromCounts({
    pendingApprovalCount: session.pendingApprovals.length,
    pendingQuestionCount: session.pendingQuestions.length,
  });
