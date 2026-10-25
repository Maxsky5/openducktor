import type { AutopilotRule, AutopilotSettings } from "@openducktor/contracts";
import {
  BUILTIN_SIGNAL_IDS,
  builtinAutomationId,
  type BuiltinAutomationId as AutopilotActionId,
  type BuiltinSignalId as AutopilotEventId,
} from "@openducktor/workflows";

export const AUTOPILOT_DISABLED_VALUE = "disabled" as const;

export type AutopilotSelectValue = AutopilotActionId | typeof AUTOPILOT_DISABLED_VALUE;

export const getAutopilotRule = (
  settings: AutopilotSettings,
  eventId: AutopilotEventId,
): AutopilotRule => {
  return settings.rules.find((rule) => rule.eventId === eventId) ?? { eventId, actionIds: [] };
};

export const getAutopilotSelectedValue = (rule: AutopilotRule): AutopilotSelectValue => {
  const actionId = rule.actionIds[0];
  return actionId === undefined ? AUTOPILOT_DISABLED_VALUE : builtinAutomationId(actionId);
};

const hasSameActionIds = (
  left: AutopilotRule["actionIds"],
  right: AutopilotRule["actionIds"],
): boolean => {
  return left.length === right.length && left.every((actionId, index) => actionId === right[index]);
};

export const setAutopilotRuleAction = (
  settings: AutopilotSettings,
  eventId: AutopilotEventId,
  value: AutopilotSelectValue,
): AutopilotSettings => {
  const currentRulesByEvent = new Map(settings.rules.map((rule) => [rule.eventId, rule]));
  let hasChanged = false;

  const rules = BUILTIN_SIGNAL_IDS.map((id) => {
    const currentRule = currentRulesByEvent.get(id) ?? { eventId: id, actionIds: [] };
    if (!currentRulesByEvent.has(id)) {
      hasChanged = true;
    }

    if (id !== eventId) {
      return currentRule;
    }

    const nextActionIds =
      value === AUTOPILOT_DISABLED_VALUE
        ? []
        : [value, ...currentRule.actionIds.filter((actionId) => actionId !== value)];

    if (hasSameActionIds(currentRule.actionIds, nextActionIds)) {
      return currentRule;
    }

    hasChanged = true;

    return {
      eventId: id,
      actionIds: nextActionIds,
    };
  });

  return hasChanged ? { ...settings, rules } : settings;
};
