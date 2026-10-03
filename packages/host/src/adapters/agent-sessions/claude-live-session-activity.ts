import type { AgentSessionControlSummary, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";

export const activityForSummary = (
  status: AgentSessionControlSummary["status"],
): AgentSessionLiveSnapshot["activity"] =>
  status === "starting" || status === "running" ? "running" : "idle";

export const activityForPending = (
  snapshot: AgentSessionLiveSnapshot,
): AgentSessionLiveSnapshot["activity"] => {
  if (snapshot.pendingQuestions.length > 0) {
    return "waiting_for_question";
  }
  if (snapshot.pendingApprovals.length > 0) {
    return "waiting_for_permission";
  }
  return "running";
};

export const activityForStatus = (
  status: Extract<AgentEvent, { type: "session_status" }>["status"],
  snapshot: AgentSessionLiveSnapshot,
): AgentSessionLiveSnapshot["activity"] => {
  if (status.type === "busy") {
    return "running";
  }
  if (status.type === "retry") {
    return "retrying";
  }
  const pendingActivity = activityForPending(snapshot);
  return pendingActivity === "running" ? "idle" : pendingActivity;
};
