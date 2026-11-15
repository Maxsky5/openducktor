import type { AgentModelDescriptor } from "../types/agent-orchestrator";

export const resolveModelSelectionPolicy = (
  model: AgentModelDescriptor | null,
  liveSession: boolean,
) => {
  return {
    canChangeProfile: !liveSession || model?.liveSessionUpdates?.profile !== false,
    variants: model?.variants ?? [],
  };
};
