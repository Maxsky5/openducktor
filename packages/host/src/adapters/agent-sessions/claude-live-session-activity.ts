import type { AgentSessionControlSummary, AgentSessionLiveSnapshot } from "@openducktor/contracts";

export const activityForSummary = (
  status: AgentSessionControlSummary["status"],
): AgentSessionLiveSnapshot["activity"] =>
  status === "starting" || status === "running" ? "running" : "idle";
