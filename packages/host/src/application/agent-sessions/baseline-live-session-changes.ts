import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
export const baselineLiveSessionChanges = (
  changes: AgentSessionLiveAdapterChange[],
): AgentSessionLiveAdapterChange[] =>
  changes.map((change) => ({ ...change, provenance: "baseline" }));
