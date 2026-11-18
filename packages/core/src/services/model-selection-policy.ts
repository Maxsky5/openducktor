import type { AgentModelDescriptor } from "../types/agent-orchestrator";

export const canChangeLiveProfile = (
  model: AgentModelDescriptor | null,
  liveSession: boolean,
): boolean => !liveSession || model?.liveSessionUpdates?.profile !== false;
