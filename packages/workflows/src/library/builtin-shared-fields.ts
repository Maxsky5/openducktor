import type { NotificationKindSetting, WorkflowStateDefinition } from "@openducktor/contracts";
import { SPEC_PLAN_BUILD_DEFINITION } from "../builtin/spec-plan-build/definition";

/** The fields of a state that every workflow shares for the state ID. */
export type SharedStateFields = Pick<
  WorkflowStateDefinition,
  "label" | "title" | "shortLabel" | "tone"
>;

const builtinStateList: readonly WorkflowStateDefinition[] = SPEC_PLAN_BUILD_DEFINITION.states;
const builtinStates: ReadonlyMap<string, SharedStateFields> = new Map(
  builtinStateList.map((state) => [
    state.id,
    { label: state.label, title: state.title, shortLabel: state.shortLabel, tone: state.tone },
  ]),
);
const builtinNotificationDefaults: ReadonlyMap<string, NotificationKindSetting> = new Map(
  builtinStateList.flatMap(({ notification }) =>
    notification ? [[notification.kind, notification.defaultSetting] as const] : [],
  ),
);

/** The built-in label, title, short label, and tone of a state ID, or undefined. */
export const builtinSharedState = (stateId: string): SharedStateFields | undefined =>
  builtinStates.get(stateId);

/** The built-in default setting of a notification kind, or undefined. */
export const builtinNotificationDefault = (kind: string): NotificationKindSetting | undefined =>
  builtinNotificationDefaults.get(kind);

/** Sets or removes an optional field, so the JSON form never holds an undefined field. */
const setOptional = <Value extends object, Key extends keyof Value>(
  value: Value,
  key: Key,
  field: Value[Key] | undefined,
): void => {
  if (field === undefined) delete value[key];
  else value[key] = field;
};

type StatesOwner = { readonly states: readonly WorkflowStateDefinition[] };

/**
 * Gives each state and notification kind that the built-in workflow uses the built-in label,
 * title, short label, tone, and notification default. The host applies it each time it compiles
 * a custom version, so an app update of the built-in workflow keeps custom versions valid.
 */
export const withBuiltinSharedFields = <Definition extends StatesOwner>(
  definition: Definition,
): Definition => ({
  ...definition,
  states: definition.states.map((source) => {
    const state: WorkflowStateDefinition = structuredClone(source);
    const shared = builtinStates.get(state.id);
    if (shared) {
      state.label = shared.label;
      setOptional(state, "title", shared.title);
      setOptional(state, "shortLabel", shared.shortLabel);
      setOptional(state, "tone", shared.tone);
    }
    const defaultSetting =
      state.notification && builtinNotificationDefaults.get(state.notification.kind);
    if (state.notification && defaultSetting)
      state.notification.defaultSetting = { ...defaultSetting };
    return state;
  }),
});
