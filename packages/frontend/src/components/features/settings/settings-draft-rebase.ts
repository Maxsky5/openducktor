import {
  autopilotRuleKey,
  isJsonObject,
  type JsonValue,
  jsonValuesEqual,
  type SettingsSnapshot,
} from "@openducktor/contracts";

export const rebaseSettingsDraft = (
  baseline: SettingsSnapshot,
  draft: SettingsSnapshot,
  fresh: SettingsSnapshot,
): SettingsSnapshot => {
  const result = { ...rebaseFields(baseline, draft, fresh) };
  result.customAgentRoles = rebaseRecords(
    baseline.customAgentRoles,
    draft.customAgentRoles,
    fresh.customAgentRoles,
    (role) => role.id,
  );
  result.autopilot = {
    ...result.autopilot,
    rules: rebaseRecords(
      baseline.autopilot.rules,
      draft.autopilot.rules,
      fresh.autopilot.rules,
      (rule) => autopilotRuleKey(rule.workflowId, rule.eventId),
    ),
  };
  return result;
};

/** Keep edited leaves, including invalid editor text, and refresh every clean leaf. */
function rebaseFields<Value extends JsonValue>(baseline: Value, draft: Value, fresh: Value): Value;
function rebaseFields(baseline: JsonValue, draft: JsonValue, fresh: JsonValue): JsonValue {
  if (jsonValuesEqual(baseline, draft)) return fresh;
  if (!isJsonObject(baseline) || !isJsonObject(draft) || !isJsonObject(fresh)) return draft;
  const result = { ...fresh };
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(draft)])) {
    if (jsonValuesEqual(baseline[key], draft[key])) continue;
    if (!(key in draft)) delete result[key];
    else result[key] = rebaseFields(baseline[key], draft[key], fresh[key]);
  }
  return result;
}

const rebaseRecords = <Value extends JsonValue>(
  baseline: readonly Value[],
  draft: readonly Value[],
  fresh: readonly Value[],
  key: (value: Value) => string,
): Value[] => {
  const before = new Map(baseline.map((value) => [key(value), value]));
  const edited = new Map(draft.map((value) => [key(value), value]));
  const result = new Map(fresh.map((value) => [key(value), value]));
  for (const [id, previous] of before) {
    const next = edited.get(id);
    if (next === undefined) result.delete(id);
    else if (!jsonValuesEqual(previous, next)) {
      const current = result.get(id);
      result.set(id, current === undefined ? next : rebaseFields(previous, next, current));
    }
  }
  for (const [id, value] of edited) if (!before.has(id)) result.set(id, value);
  return [...result.values()];
};
