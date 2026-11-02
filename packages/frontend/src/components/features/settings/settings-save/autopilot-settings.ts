import type { AutopilotSettings } from "@openducktor/contracts";

/** Keep each workflow's saved rules and action order when normalizing editor values. */
export const prepareAutopilotSettingsForSave = (
  autopilot: AutopilotSettings,
): AutopilotSettings => ({
  ...autopilot,
  rules: autopilot.rules.map((rule) => ({ ...rule, actionIds: [...new Set(rule.actionIds)] })),
});
