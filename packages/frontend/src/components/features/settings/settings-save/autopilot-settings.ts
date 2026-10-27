import type { AutopilotSettings } from "@openducktor/contracts";
import { BUILTIN_SIGNAL_IDS } from "@openducktor/workflows";

/** Saves one rule for each signal of the built-in workflow, in signal order. */
export const prepareAutopilotSettingsForSave = (
  autopilot: AutopilotSettings,
): AutopilotSettings => {
  const rulesByEvent = new Map(autopilot.rules.map((rule) => [rule.eventId, rule]));

  return {
    alwaysStartQaReviewsFresh: autopilot.alwaysStartQaReviewsFresh,
    rules: BUILTIN_SIGNAL_IDS.map((eventId) => ({
      eventId,
      actionIds: [...new Set(rulesByEvent.get(eventId)?.actionIds ?? [])],
    })),
  };
};
