import type { AgentSessionLiveRef } from "@openducktor/contracts";

/** Reads native parent identity without retaining or binding the session. */
export type AgentSessionQueryParentPort = {
  resolveSessionParent(input: AgentSessionLiveRef): Promise<string | null>;
};
