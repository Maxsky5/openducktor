import type {
  AutopilotActionId,
  AutopilotEventId,
  AutopilotSettings,
} from "@openducktor/contracts";
import { AUTOPILOT_EVENT_IDS, createDefaultAutopilotSettings } from "@openducktor/contracts";

export const prepareAutopilotSettingsForSave = (
  autopilot: AutopilotSettings,
): AutopilotSettings => {
  const defaultSettings = createDefaultAutopilotSettings();
  const rulesByEvent = new Map<AutopilotEventId, AutopilotSettings["rules"][number]>(
    autopilot.rules.map((rule) => [rule.eventId, rule]),
  );

  return {
    rules: AUTOPILOT_EVENT_IDS.map((eventId) => {
      const explicitRule = rulesByEvent.get(eventId);
      const actionIds = (explicitRule?.actionIds ?? []).filter(
        (actionId, index, list) => list.indexOf(actionId) === index,
      ) as AutopilotActionId[];

      return {
        eventId,
        actionIds: explicitRule
          ? actionIds
          : (defaultSettings.rules.find((rule) => rule.eventId === eventId)?.actionIds ?? []),
      };
    }),
  };
};
