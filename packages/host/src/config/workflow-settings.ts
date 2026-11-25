import {
  AGENT_NOTIFICATION_KIND_VALUES,
  DEFAULT_TASK_NOTIFICATION_KIND_SETTINGS,
  ROLE_INSTRUCTIONS_PROMPT_ID,
  TASK_NOTIFICATION_KIND_VALUES,
  autopilotRuleKey,
  parsePromptOverrideKey,
  type AgentRoleDefinition,
  type AutopilotRule,
  type GlobalConfig,
  type NotificationKindSetting,
  type RepoConfig,
} from "@openducktor/contracts";
import {
  BUILTIN_WORKFLOW_ID,
  NAMING_PROMPT_KEYS,
  namingPromptLayerProblem,
  type PromptSettingsLayers,
  type TaskWorkflow,
} from "@openducktor/workflows";
import { HostValidationError } from "../effect/host-errors";
import type { GlobalSettings } from "../ports/settings-config-port";

/**
 * The owners of workflow settings: the latest version of each workflow, the built-in workflow
 * first, and the host role catalog. A save checks keys against them. A read accepts a key when its
 * owner exists, because prompt, Autopilot, and notification settings apply by ID to every version.
 */
export type WorkflowSettingsSource = {
  readonly latest: readonly TaskWorkflow[];
  readonly roles: readonly AgentRoleDefinition[];
};

/** The workflow-keyed settings that the saved settings already hold. */
export type SavedWorkflowSettingKeys = {
  readonly prompts: ReadonlySet<string>;
  readonly notificationKinds: ReadonlySet<string>;
  /** The saved action IDs of each saved rule, by rule key. */
  readonly autopilotRules: ReadonlyMap<string, ReadonlySet<string>>;
};

/**
 * A read accepts every key of an existing owner. A save checks new keys against the latest version
 * and keeps the keys that the saved settings already hold, because a key of an older version or of
 * a deleted workflow stays in the saved settings and the user cannot remove it.
 */
export type WorkflowSettingsMode = "read" | { readonly saved: SavedWorkflowSettingKeys };

/** The workflow-keyed settings of saved settings, so that a save keeps the keys of older versions. */
export const savedWorkflowSettingKeys = (config: GlobalConfig): SavedWorkflowSettingKeys => ({
  prompts: new Set([
    ...Object.keys(config.globalPromptOverrides),
    ...Object.keys(config.globalPromptAppends),
    ...Object.values(config.workspaces).flatMap((workspace) => [
      ...Object.keys(workspace.promptOverrides),
      ...Object.keys(workspace.promptAppends),
    ]),
  ]),
  notificationKinds: new Set(Object.keys(config.notifications.kinds)),
  autopilotRules: new Map(
    config.autopilot.rules.map((rule) => [
      autopilotRuleKey(rule.workflowId, rule.eventId),
      new Set(rule.actionIds),
    ]),
  ),
});

const invalid = (field: string, message: string): never => {
  throw new HostValidationError({ field, message });
};

const requireKnownKeys = (
  keys: Iterable<string>,
  known: ReadonlySet<string>,
  field: string,
  kind: string,
) => {
  for (const key of keys) {
    if (!known.has(key)) {
      invalid(
        `${field}.${key}`,
        `Unknown ${kind} "${key}" at ${field}. Use one of the task workflows or roles of this host.`,
      );
    }
  }
};

/** Rejects a naming prompt layer with a placeholder that the naming request cannot fill. */
const requireValidNamingPromptLayers = (
  layers: PromptSettingsLayers,
  scope: "global" | "repository",
  field: string,
) => {
  for (const key of NAMING_PROMPT_KEYS) {
    const problem = namingPromptLayerProblem(key, layers, scope);
    if (problem !== undefined) invalid(`${field}.${key}`, problem);
  }
};

const ids = <Item extends { id: string }>(items: readonly Item[]) => items.map(({ id }) => id);

const hostOwners = (source: WorkflowSettingsSource, mode: WorkflowSettingsMode) => {
  const notificationDefaults: Record<string, NotificationKindSetting> = {};
  for (const workflow of source.latest) {
    for (const [kind, setting] of Object.entries(workflow.notificationDefaults())) {
      if (setting && !(kind in notificationDefaults)) notificationDefaults[kind] = setting;
    }
  }
  const workflows = new Map(source.latest.map((workflow) => [workflow.definition.id, workflow]));
  /** A custom workflow keeps the settings of the IDs that only its older versions declare. */
  const isCustom = (workflowId: string) =>
    workflowId !== BUILTIN_WORKFLOW_ID && workflows.has(workflowId);
  const acceptsAnyId = (workflowId: string) => mode === "read" && isCustom(workflowId);
  const roles = new Set(ids(source.roles));
  const promptKeys = new Set(
    source.latest.flatMap(({ prompts }) => prompts.templates.map(({ key }) => key)),
  );
  return {
    roles,
    writeRoles: new Set(
      ids(source.roles.filter(({ workspaceAccess }) => workspaceAccess === "write")),
    ),
    notificationDefaults,
    workflows,
    isCustom,
    acceptsAnyId,
    knowsPrompt: (key: string) => {
      if (NAMING_PROMPT_KEYS.has(key)) return true;
      const target = parsePromptOverrideKey(key);
      if (!target) return false;
      if (target.ownerKind === "role")
        return roles.has(target.ownerId) && target.promptId === ROLE_INSTRUCTIONS_PROMPT_ID;
      return (
        acceptsAnyId(target.ownerId) ||
        promptKeys.has(key) ||
        (mode !== "read" && workflows.has(target.ownerId) && mode.saved.prompts.has(key))
      );
    },
  };
};
type HostOwners = ReturnType<typeof hostOwners>;

const requireKnownPrompts = (keys: Iterable<string>, host: HostOwners, field: string) => {
  for (const key of keys)
    if (!host.knowsPrompt(key))
      invalid(
        `${field}.${key}`,
        `Unknown prompt "${key}" at ${field}. Use a prompt of a task workflow or role of this host.`,
      );
};

/**
 * Checks the settings that task workflows and roles key, and adds the workflow defaults of the
 * latest versions. Settings cover every workflow of the host, because the tasks of one workspace
 * can follow different workflows. A key without an owner fails, so the user fixes the setting.
 */
export const applyGlobalTaskWorkflowSettings = (
  config: GlobalSettings,
  source: WorkflowSettingsSource,
  mode: WorkflowSettingsMode,
): GlobalSettings => {
  const host = hostOwners(source, mode);
  for (const [kind, runtime] of Object.entries(config.agentRuntimes)) {
    if ("roleOverrides" in runtime) {
      requireKnownKeys(
        Object.keys(runtime.roleOverrides),
        host.roles,
        `agentRuntimes.${kind}.roleOverrides`,
        "role",
      );
    }
  }
  for (const [role, override] of Object.entries(config.agentRuntimes.codex.roleOverrides)) {
    if (host.writeRoles.has(role) && override?.sandboxMode === "read-only") {
      invalid(
        `agentRuntimes.codex.roleOverrides.${role}.sandboxMode`,
        `Codex ${role} role sandboxMode cannot be read-only; use workspace-write or danger-full-access.`,
      );
    }
  }
  requireKnownPrompts(Object.keys(config.globalPromptOverrides), host, "globalPromptOverrides");
  requireKnownPrompts(Object.keys(config.globalPromptAppends), host, "globalPromptAppends");
  requireValidNamingPromptLayers(
    { overrides: config.globalPromptOverrides, appends: config.globalPromptAppends },
    "global",
    "globalPromptOverrides",
  );

  if (mode !== "read")
    requireKnownKeys(
      Object.keys(config.notifications.kinds),
      new Set<string>([
        ...AGENT_NOTIFICATION_KIND_VALUES,
        ...TASK_NOTIFICATION_KIND_VALUES,
        ...Object.keys(host.notificationDefaults),
        ...mode.saved.notificationKinds,
      ]),
      "notifications.kinds",
      "notification",
    );

  const rulesByEvent = new Map(
    config.autopilot.rules.map((rule) => [autopilotRuleKey(rule.workflowId, rule.eventId), rule]),
  );
  config.autopilot.rules.forEach((rule, index) => {
    const workflow = host.workflows.get(rule.workflowId);
    if (!workflow)
      return invalid(
        `autopilot.rules.${index}.workflowId`,
        `Unknown Autopilot workflow "${rule.workflowId}". Use a published task workflow of this host.`,
      );
    if (host.acceptsAnyId(rule.workflowId)) return;
    const signal = workflow.definition.signals.find((value) => value.id === rule.eventId);
    // A saved rule and its saved actions may come from an older version; they still apply to its
    // tasks. Only new signals and actions must belong to the latest version.
    const savedActions =
      mode !== "read" && host.isCustom(rule.workflowId)
        ? mode.saved.autopilotRules.get(autopilotRuleKey(rule.workflowId, rule.eventId))
        : undefined;
    if (!signal && !savedActions) {
      invalid(
        `autopilot.rules.${index}.eventId`,
        `Unknown Autopilot event "${rule.eventId}". Use an event of the latest version of the task workflow.`,
      );
    }
    requireKnownKeys(
      rule.actionIds,
      new Set([...ids(workflow.definition.automations), ...(savedActions ?? [])]),
      `autopilot.rules.${index}.actionIds`,
      "Autopilot action",
    );
  });

  const latestRules = source.latest.flatMap((workflow) =>
    workflow.definition.signals.map(
      ({ id: eventId }): AutopilotRule =>
        rulesByEvent.get(autopilotRuleKey(workflow.definition.id, eventId)) ?? {
          workflowId: workflow.definition.id,
          eventId,
          actionIds: [],
        },
    ),
  );
  const latestRuleKeys = new Set(
    latestRules.map((rule) => autopilotRuleKey(rule.workflowId, rule.eventId)),
  );
  // Rules of signals that only older custom versions declare follow, so a save keeps them.
  const olderRules = config.autopilot.rules.filter(
    (rule) =>
      host.isCustom(rule.workflowId) &&
      !latestRuleKeys.has(autopilotRuleKey(rule.workflowId, rule.eventId)),
  );
  return {
    ...config,
    notifications: {
      ...config.notifications,
      kinds: {
        ...DEFAULT_TASK_NOTIFICATION_KIND_SETTINGS,
        ...host.notificationDefaults,
        ...config.notifications.kinds,
      },
    },
    autopilot: {
      ...config.autopilot,
      rules: [...latestRules, ...olderRules],
    },
  };
};

export const validateRepoTaskWorkflowSettings = (
  workspace: RepoConfig,
  source: WorkflowSettingsSource,
  mode: WorkflowSettingsMode,
): RepoConfig => {
  const host = hostOwners(source, mode);
  const field = `workspaces.${workspace.workspaceId}`;
  requireKnownKeys(
    Object.keys(workspace.agentDefaults),
    host.roles,
    `${field}.agentDefaults`,
    "role",
  );
  requireKnownPrompts(Object.keys(workspace.promptOverrides), host, `${field}.promptOverrides`);
  requireKnownPrompts(Object.keys(workspace.promptAppends), host, `${field}.promptAppends`);
  requireValidNamingPromptLayers(
    { overrides: workspace.promptOverrides, appends: workspace.promptAppends },
    "repository",
    `${field}.promptOverrides`,
  );
  return workspace;
};

/**
 * The active task is selection state, as its task ID is: the settings keep a role that is gone, so
 * a deleted role never stops a read or a save. A preference write names only a known new role.
 */
export const requireKnownActiveRole = (
  current: RepoConfig,
  next: RepoConfig["agentStudioState"],
  source: WorkflowSettingsSource,
): void => {
  const role = next.activeTask?.role;
  if (role === undefined || role === current.agentStudioState.activeTask?.role) return;
  if (!source.roles.some(({ id }) => id === role))
    invalid(
      `workspaces.${current.workspaceId}.agentStudioState.activeTask.role`,
      `Unknown role "${role}". Pick a role of this host.`,
    );
};

export const applyTaskWorkflowSettings = (
  config: GlobalConfig,
  source: WorkflowSettingsSource,
  mode: WorkflowSettingsMode,
): GlobalConfig => {
  const global = applyGlobalTaskWorkflowSettings(config, source, mode);
  for (const workspace of Object.values(config.workspaces))
    validateRepoTaskWorkflowSettings(workspace, source, mode);
  return { ...global, workspaces: config.workspaces };
};
