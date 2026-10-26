import { perConnection } from "@openducktor/frontend-core/lib/per-connection";
import type {
  AutopilotFailedOutcome,
  AutopilotRecovery,
} from "@openducktor/frontend-core/autopilot/autopilot-recovery";
import { createAutopilotRecovery } from "@openducktor/frontend-core/autopilot/autopilot-recovery";

/**
 * The first-message recoveries of one host connection. A recovery outlives each view that shows
 * it, so a claim that this client holds stays when the task details close and open again.
 */
export type HeldOutcomeRecoveries = {
  recoveryOf: (outcome: AutopilotFailedOutcome) => AutopilotRecovery | null;
};

export const createHeldOutcomeRecoveries = (): HeldOutcomeRecoveries => {
  const recoveries = new Map<string, AutopilotRecovery>();
  return {
    recoveryOf: (outcome) => {
      const known = recoveries.get(outcome.outcomeId);
      if (known) return known;
      const recovery = createAutopilotRecovery(outcome);
      if (recovery) recoveries.set(outcome.outcomeId, recovery);
      return recovery;
    },
  };
};

/** The recoveries of a connection, which lives as long as the connection. */
export const heldOutcomeRecoveriesOf = perConnection(() => createHeldOutcomeRecoveries());
