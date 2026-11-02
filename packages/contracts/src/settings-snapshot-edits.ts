import {
  autopilotRuleKey,
  autopilotSettingsSchema,
  globalConfigSchema,
  repoConfigSchema,
  settingsSnapshotSaveInputSchema,
  settingsSnapshotSchema,
  type AutopilotSettings,
  type AutopilotSettingsPatch,
  type GlobalConfig,
  type GlobalSettingsPatch,
  type RepoConfig,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
  type WorkspaceSettingsPatch,
  HOST_PREFERENCE_FIELDS,
} from "./config-schemas";
import { jsonValuesEqual } from "./json-values-equal";

type PatchMode = "request" | "acknowledged";
type SettingsValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SettingsValue[]
  | SettingsObject;
type SettingsObject = { [key: string]: SettingsValue };
type Rule =
  | "replace"
  | { fields: Record<string, Rule>; rest: Rule | null }
  | { optional: Rule }
  | { keyed: Rule };

/** Return the settings leaves that changed from the loaded baseline. */
export const diffSettingsSnapshot = (
  before: SettingsSnapshot,
  after: SettingsSnapshot,
): SettingsSnapshotSaveInput => {
  const result: SettingsObject = {};
  const global = diff(globalRule, before, {
    ...after,
    agentRuntimes: Object.fromEntries(
      Object.entries(after.agentRuntimes).filter(
        ([kind]) => before.agentRuntimes[kind] !== undefined,
      ),
    ),
  });
  if (global) result.global = global;
  const workspaces: SettingsObject = {};
  for (const [id, workspace] of Object.entries(after.workspaces)) {
    const previous = before.workspaces[id];
    if (!previous) continue;
    const { workspaceId: _workspaceId, ...fields } = workspace;
    const edits = diff(workspaceRule, previous, fields);
    if (edits) {
      workspaces[id] = {
        ...asObject(edits),
        expectedRepoPath: previous.repoPath,
      };
    }
  }
  if (Object.keys(workspaces).length) result.workspaces = workspaces;
  const roles = asObject(
    diff(rolesRule, roleRecords(before.customAgentRoles), roleRecords(after.customAgentRoles)),
  );
  if (Object.keys(roles).length)
    result.customAgentRoles = {
      ...roles,
      create: roles.create ? Object.values(asObject(roles.create)) : undefined,
    };
  const previousRules = new Map(before.autopilot.rules.map((rule) => [ruleKey(rule), rule]));
  const rules = after.autopilot.rules.filter((rule) =>
    differs(previousRules.get(ruleKey(rule)), rule),
  );
  const autopilot: AutopilotSettingsPatch = {};
  if (before.autopilot.alwaysStartQaReviewsFresh !== after.autopilot.alwaysStartQaReviewsFresh)
    autopilot.alwaysStartQaReviewsFresh = after.autopilot.alwaysStartQaReviewsFresh;
  if (rules.length) autopilot.rules = rules;
  if (Object.keys(autopilot).length) result.autopilot = autopilot;
  return settingsSnapshotSaveInputSchema.parse(result);
};

/** Keep original records for pending updates whose saved target was removed. */
export const retainSettingsSnapshotUpdateTargets = (
  baseline: SettingsSnapshot,
  draft: SettingsSnapshot,
  fresh: SettingsSnapshot,
): SettingsSnapshot => {
  const roles = retainUpdateTargets(
    rolesRule,
    roleRecords(baseline.customAgentRoles),
    roleRecords(draft.customAgentRoles),
    roleRecords(fresh.customAgentRoles),
  );
  const currentRoleIds = new Set(fresh.customAgentRoles.map((role) => role.id));
  return {
    ...retainUpdateTargets(globalRule, baseline, draft, fresh),
    workspaces: retainUpdateTargets(
      keyed(workspaceRule),
      baseline.workspaces,
      draft.workspaces,
      fresh.workspaces,
    ),
    customAgentRoles: [
      ...fresh.customAgentRoles,
      ...baseline.customAgentRoles.filter(
        (role) => !currentRoleIds.has(role.id) && roles[role.id] !== undefined,
      ),
    ],
  };
};

/** Apply confirmed leaves after a full or partial save. */
export const applySettingsSnapshotPatch = (
  current: SettingsSnapshot,
  input: SettingsSnapshotSaveInput,
  acknowledged: { preferences: boolean },
): SettingsSnapshot => {
  const global: GlobalSettingsPatch | undefined = acknowledged.preferences
    ? input.global
    : Object.fromEntries(
        Object.entries(input.global ?? {}).filter(
          ([key]) => !Object.hasOwn(HOST_PREFERENCE_FIELDS, key),
        ),
      );
  const next = asObject(applyGlobal(current, global, "acknowledged"));
  const workspaces = { ...asObject(current.workspaces) };
  for (const [id, patch] of Object.entries(input.workspaces ?? {})) {
    const workspace = workspaces[id];
    const { expectedRepoPath: _expectedRepoPath, ...fields } = patch;
    // A catalog event can remove this workspace before the Save receipt arrives.
    if (workspace)
      workspaces[id] = asObject(apply(workspaceRule, workspace, fields, "acknowledged"));
  }
  return settingsSnapshotSchema.parse({
    ...next,
    workspaces,
    customAgentRoles: applyRoles(current.customAgentRoles, input.customAgentRoles, "acknowledged"),
    autopilot: applyAutopilot(current.autopilot, input.autopilot),
  });
};

export const applyGlobalSettingsPatch = (
  current: GlobalConfig,
  patch: GlobalSettingsPatch | undefined,
  mode: PatchMode,
): GlobalConfig => globalConfigSchema.parse(applyGlobal(current, patch, mode));

export const applyWorkspaceSettingsPatch = (
  current: RepoConfig,
  patch: WorkspaceSettingsPatch,
): RepoConfig => {
  const { expectedRepoPath: _expectedRepoPath, ...fields } = patch;
  return repoConfigSchema.parse(apply(workspaceRule, current, fields, "request"));
};

export const applyCustomAgentRoleEdits = (
  current: GlobalConfig["customAgentRoles"],
  edits: SettingsSnapshotSaveInput["customAgentRoles"],
  mode: PatchMode,
): GlobalConfig["customAgentRoles"] =>
  edits
    ? globalConfigSchema.shape.customAgentRoles.parse(applyRoles(current, edits, mode))
    : current;

export const applyAutopilotSettingsPatch = (
  current: AutopilotSettings,
  patch: AutopilotSettingsPatch | undefined,
): AutopilotSettings =>
  patch ? autopilotSettingsSchema.parse(applyAutopilot(current, patch)) : current;

const object = (fields: Record<string, Rule> = {}, rest: Rule | null = "replace"): Rule => ({
  fields,
  rest,
});
const optional = (value: Rule = "replace"): Rule => ({ optional: value });
const keyed = (value: Rule): Rule => ({ keyed: value });

const modelRule = object({ variant: optional(), profileId: optional() });
const promptRule = object({ enabled: optional() });
const claudeRule = object(
  {
    permissions: optional(object({}, optional())),
    sandbox: optional(
      object(
        {
          filesystem: optional(object({}, optional())),
          network: optional(object({}, optional())),
        },
        optional(),
      ),
    ),
  },
  optional(),
);
const globalRule = object(
  {
    system: object({}, optional()),
    git: object(),
    general: object(),
    appearance: object(),
    chat: object(),
    kanban: object(),
    notifications: object(),
    reusablePrompts: "replace",
    agentRuntimes: object(
      {
        codex: object({ defaults: object(), roleOverrides: keyed(object({}, optional())) }),
        claude: object({ defaults: claudeRule, roleOverrides: keyed(claudeRule) }),
        opencode: object({ defaults: object(), roleOverrides: keyed(object()) }),
      },
      object(),
    ),
    globalPromptOverrides: keyed(promptRule),
  },
  null,
);
const workspaceRule = object({
  abbreviation: optional(),
  tileColor: optional(),
  defaultModel: optional(modelRule),
  worktreeBasePath: optional(),
  defaultTargetBranch: object({ remote: optional() }),
  git: object({
    provider: optional(
      object({
        repository: optional(),
        settings: optional(object({}, optional())),
      }),
    ),
  }),
  hooks: object(),
  actions: "replace",
  promptOverrides: keyed(promptRule),
  agentDefaults: keyed(modelRule),
});
const rolesRule = keyed(object());

// SAFETY: The public settings schemas validate all values and patch object shapes.
const asObject = (value: SettingsValue): SettingsObject => (value ?? {}) as SettingsObject;
const differs = (before: SettingsValue, after: SettingsValue): boolean =>
  !jsonValuesEqual(before, after);

const retainUpdateTargets = <Value extends SettingsValue>(
  rule: Rule,
  baseline: Value,
  draft: Value,
  fresh: Value,
): Value => {
  if (
    rule === "replace" ||
    !differs(baseline, draft) ||
    baseline === undefined ||
    draft === undefined ||
    fresh === undefined
  )
    return fresh;
  if ("optional" in rule) return retainUpdateTargets(rule.optional, baseline, draft, fresh);
  const prior = asObject(baseline);
  const edited = asObject(draft);
  const next = { ...asObject(fresh) };
  if ("keyed" in rule) {
    for (const [key, previous] of Object.entries(prior)) {
      if (edited[key] === undefined || !differs(previous, edited[key])) continue;
      next[key] =
        next[key] === undefined
          ? previous
          : retainUpdateTargets(rule.keyed, previous, edited[key], next[key]);
    }
  } else {
    for (const key of Object.keys(next)) {
      const child = Object.hasOwn(rule.fields, key) ? rule.fields[key] : rule.rest;
      if (child) next[key] = retainUpdateTargets(child, prior[key], edited[key], next[key]);
    }
  }
  // SAFETY: Each rule keeps the settings shape and restores only original record values.
  return next as Value;
};

const diff = (rule: Rule, before: SettingsValue, after: SettingsValue): SettingsValue => {
  if (!differs(before, after)) return undefined;
  if (rule === "replace") return after;
  if ("optional" in rule)
    return after === undefined
      ? { type: "clear" }
      : { type: "set", value: diff(rule.optional, before, after) ?? {} };
  const prior = asObject(before);
  const next = asObject(after);
  const edits: SettingsObject = {};
  if ("keyed" in rule) {
    const create: SettingsObject = {};
    const update: SettingsObject = {};
    const remove = Object.keys(prior).filter((key) => next[key] === undefined);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) continue;
      if (prior[key] === undefined) create[key] = value;
      else if (differs(prior[key], value)) update[key] = diff(rule.keyed, prior[key], value) ?? {};
    }
    if (Object.keys(create).length) edits.create = create;
    if (Object.keys(update).length) edits.update = update;
    if (remove.length) edits.remove = remove;
  } else {
    const keys = rule.rest ? Object.keys({ ...prior, ...next }) : Object.keys(rule.fields);
    for (const key of keys) {
      const child = Object.hasOwn(rule.fields, key) ? rule.fields[key] : rule.rest;
      if (!child) continue;
      const edit = diff(child, prior[key], next[key]);
      if (edit !== undefined) edits[key] = edit;
    }
  }
  return Object.keys(edits).length ? edits : undefined;
};

const apply = (
  rule: Rule,
  current: SettingsValue,
  patch: SettingsValue,
  mode: PatchMode,
): SettingsValue => {
  if (patch === undefined) return current;
  if (rule === "replace") return patch;
  const edits = asObject(patch);
  if ("optional" in rule)
    return edits.type === "clear" ? undefined : apply(rule.optional, current, edits.value, mode);
  const next = { ...asObject(current) };
  if ("keyed" in rule) {
    const touched = new Set<string>();
    const touch = (key: string) => {
      if (touched.has(key)) throw new Error(`Settings record ${key} has more than one edit.`);
      touched.add(key);
    };
    for (const [key, value] of Object.entries(asObject(edits.create))) {
      touch(key);
      if (next[key] !== undefined) {
        if (mode === "acknowledged") continue;
        throw new Error(`Settings record ${key} already exists. Reload settings and retry.`);
      }
      next[key] = value;
    }
    for (const [key, edit] of Object.entries(asObject(edits.update))) {
      touch(key);
      if (next[key] === undefined) {
        if (mode === "acknowledged") continue;
        throw new Error(`Settings record ${key} no longer exists. Reload settings and retry.`);
      }
      next[key] = apply(rule.keyed, next[key], edit, mode);
    }
    // SAFETY: The keyed edit schema validates remove as a string array.
    for (const key of (edits.remove ?? []) as string[]) {
      touch(key);
      delete next[key];
    }
  } else {
    for (const [key, edit] of Object.entries(edits)) {
      const child = Object.hasOwn(rule.fields, key) ? rule.fields[key] : rule.rest;
      if (!child || edit === undefined) continue;
      const value = apply(child, next[key], edit, mode);
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
  }
  return next;
};

const applyGlobal = (
  current: GlobalConfig | SettingsSnapshot,
  patch: GlobalSettingsPatch | undefined,
  mode: PatchMode,
): SettingsValue => {
  for (const kind of Object.keys(patch?.agentRuntimes ?? {}))
    if (!current.agentRuntimes[kind])
      throw new Error(`Runtime ${kind} is no longer configured. Reload settings and retry.`);
  return apply(globalRule, current, patch, mode);
};

const roleRecords = (
  roles: GlobalConfig["customAgentRoles"],
): Record<string, GlobalConfig["customAgentRoles"][number]> =>
  Object.fromEntries(roles.map((role) => [role.id, role]));
const applyRoles = (
  current: GlobalConfig["customAgentRoles"],
  edits: SettingsSnapshotSaveInput["customAgentRoles"],
  mode: PatchMode,
): SettingsValue[] => {
  if (!edits) return current;
  if (new Set(edits.create?.map((role) => role.id)).size !== (edits.create?.length ?? 0))
    throw new Error("Custom Agent Role IDs must be unique.");
  return Object.values(
    asObject(
      apply(
        rolesRule,
        roleRecords(current),
        { ...edits, create: roleRecords(edits.create ?? []) },
        mode,
      ),
    ),
  );
};

const ruleKey = (rule: AutopilotSettings["rules"][number]): string =>
  autopilotRuleKey(rule.workflowId, rule.eventId);
const applyAutopilot = (
  current: AutopilotSettings,
  patch: AutopilotSettingsPatch | undefined,
): AutopilotSettings => {
  if (!patch) return current;
  const rules = new Map(current.rules.map((rule) => [ruleKey(rule), rule]));
  const touched = new Set<string>();
  for (const rule of patch.rules ?? []) {
    const key = ruleKey(rule);
    if (touched.has(key))
      throw new Error(`Autopilot rule ${rule.workflowId}/${rule.eventId} has more than one edit.`);
    touched.add(key);
    rules.set(key, rule);
  }
  return {
    alwaysStartQaReviewsFresh: patch.alwaysStartQaReviewsFresh ?? current.alwaysStartQaReviewsFresh,
    rules: [...rules.values()],
  };
};
