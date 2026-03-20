import type { AgentSessionState } from "@/types/agent-orchestrator";

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
    return pendingQuestionCount === 1
      ? "Answer the pending question above to continue"
      : "Answer the pending questions above to continue";
  }

  if (pendingPermissionCount > 0) {
    return pendingPermissionCount === 1
      ? "Respond to the pending permission request above to continue"
      : "Respond to the pending permission requests above to continue";
  }

  return null;
};
