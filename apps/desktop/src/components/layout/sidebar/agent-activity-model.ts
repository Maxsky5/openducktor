import type { AgentSessionState } from "@/types/agent-orchestrator";

export type AgentActivitySummary = {
  activeSessionCount: number;
  waitingForInputCount: number;
};

const ACTIVE_SESSION_STATUS: ReadonlySet<AgentSessionState["status"]> = new Set([
  "starting",
  "running",
]);

export const summarizeAgentActivity = (sessions: AgentSessionState[]): AgentActivitySummary => {
  let activeSessionCount = 0;
  let waitingForInputCount = 0;

  for (const session of sessions) {
    if (ACTIVE_SESSION_STATUS.has(session.status)) {
      activeSessionCount += 1;
    }

    if (session.pendingPermissions.length > 0 || session.pendingQuestions.length > 0) {
      waitingForInputCount += 1;
    }
  }

  return {
    activeSessionCount,
    waitingForInputCount,
  };
};
