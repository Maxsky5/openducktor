import type { AgentModelDescriptor } from "../types/agent-orchestrator";

export const resolveModelSelectionPolicy = (
  model: AgentModelDescriptor | null,
  liveSession: boolean,
) => {
  const variants = model?.variants ?? [];
  const liveVariants = liveSession ? model?.liveSessionUpdates?.variants : undefined;
  const allowedVariants = liveVariants ? new Set(liveVariants) : null;
  return {
    canChangeProfile: !liveSession || model?.liveSessionUpdates?.profile !== false,
    variants: allowedVariants
      ? variants.filter((variant) => allowedVariants.has(variant))
      : variants,
  };
};
