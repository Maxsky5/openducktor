import {
  BUILTIN_AUTOMATIONS,
  BUILTIN_SIGNALS,
  type BuiltinAutomation,
  type BuiltinSignal,
} from "./definition";
import { getSessionLaunchAction } from "./launch";
import type { BuiltinAutomationId, BuiltinRoleId } from "./ids";

export type AutopilotActionDefinition = BuiltinAutomation & { role: BuiltinRoleId };

/** Each Autopilot action runs as the role of its launch action. */
const autopilotActions: readonly AutopilotActionDefinition[] = BUILTIN_AUTOMATIONS.map(
  (automation) => ({
    ...automation,
    role: getSessionLaunchAction(automation.launchActionId).role,
  }),
);

/** The Autopilot events, in definition order. */
export const AUTOPILOT_EVENTS: readonly BuiltinSignal[] = BUILTIN_SIGNALS;

const actionsById = new Map<string, AutopilotActionDefinition>(
  autopilotActions.map((action) => [action.id, action]),
);

export const getAutopilotAction = (id: string): AutopilotActionDefinition => {
  const action = actionsById.get(id);
  if (!action) throw new Error(`The built-in workflow has no Autopilot action ${id}.`);
  return action;
};

export const isAutopilotActionId = (value: string): value is BuiltinAutomationId =>
  actionsById.has(value);
