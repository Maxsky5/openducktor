import type { AgentSessionState } from "@/types/agent-orchestrator";

const pendingInputNoun = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

export const isAgentSessionWaitingInput = (
  session: Pick<AgentSessionState, "pendingPermissions" | "pendingQuestions">,
): boolean => session.pendingPermissions.length > 0 || session.pendingQuestions.length > 0;

export const getAgentSessionWaitingInputPlaceholder = (
  session: Pick<AgentSessionState, "pendingPermissions" | "pendingQuestions">,
): string | null => {
  const pendingQuestionCount = session.pendingQuestions.length;
  const pendingPermissionCount = session.pendingPermissions.length;

  if (pendingQuestionCount > 0 && pendingPermissionCount > 0) {
    return "Resolve the pending questions and permission requests above to continue";
  }

  if (pendingQuestionCount > 0) {
    return `Answer the pending ${pendingInputNoun(pendingQuestionCount, "question", "questions")} above to continue`;
  }

  if (pendingPermissionCount > 0) {
    return `Respond to the pending ${pendingInputNoun(
      pendingPermissionCount,
      "permission request",
      "permission requests",
    )} above to continue`;
  }

  return null;
};
