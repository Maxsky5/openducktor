import type { AgentModelDescriptor } from "../types/agent-orchestrator";

/** Tells whether a session can change its profile. A model can forbid it in a live session. */
export const canChangeLiveProfile = (
  model: AgentModelDescriptor | null,
  liveSession: boolean,
): boolean => !liveSession || model?.liveSessionUpdates?.profile !== false;
