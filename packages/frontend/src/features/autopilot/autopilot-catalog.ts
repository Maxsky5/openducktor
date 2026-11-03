import type { AutopilotRule, AutopilotSettings } from "@openducktor/contracts";
export const AUTOPILOT_DISABLED_VALUE = "disabled" as const;

export type AutopilotSelectValue = string;

export const getAutopilotRule = (
  settings: AutopilotSettings,
  workflowId: string,
  eventId: string,
): AutopilotRule =>
  settings.rules.find((rule) => rule.workflowId === workflowId && rule.eventId === eventId) ?? {
    workflowId,
    eventId,
    actionIds: [],
  };

export const getAutopilotSelectedValue = (rule: AutopilotRule): AutopilotSelectValue => {
  const actionId = rule.actionIds[0];
  return actionId === undefined ? AUTOPILOT_DISABLED_VALUE : `action:${actionId}`;
};

const hasSameActionIds = (
  left: AutopilotRule["actionIds"],
  right: AutopilotRule["actionIds"],
): boolean => {
  return left.length === right.length && left.every((actionId, index) => actionId === right[index]);
};

export const setAutopilotRuleAction = (
  settings: AutopilotSettings,
  workflowId: string,
  eventId: string,
  value: AutopilotSelectValue,
): AutopilotSettings => {
  const current = getAutopilotRule(settings, workflowId, eventId);
  const selected = value.slice("action:".length);
  const actionIds =
    value === AUTOPILOT_DISABLED_VALUE
      ? []
      : [selected, ...current.actionIds.filter((id) => id !== selected)];
  if (hasSameActionIds(current.actionIds, actionIds)) return settings;
  const next = { workflowId, eventId, actionIds };
  const matches = (rule: AutopilotRule) =>
    rule.workflowId === workflowId && rule.eventId === eventId;
  return {
    ...settings,
    rules: settings.rules.some(matches)
      ? settings.rules.map((rule) => (matches(rule) ? next : rule))
      : [...settings.rules, next],
  };
};
