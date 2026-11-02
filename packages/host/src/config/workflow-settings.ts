import {
  AGENT_NOTIFICATION_KIND_VALUES,
  autopilotRuleKey,
  type AutopilotRule,
  type GlobalConfig,
  type NotificationKindSetting,
  type RepoConfig,
} from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { HostValidationError } from "../effect/host-errors";
import type { TaskWorkflowResolver } from "../ports/task-workflow-port";
import type { GlobalSettings } from "../ports/settings-config-port";

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
        `Unknown ${kind} "${key}" at ${field}. Use one of the task workflow.`,
      );
    }
  }
};

const ids = <Item extends { id: string }>(items: readonly Item[]) => items.map(({ id }) => id);

/** The settings that every task workflow of the host defines. */
const hostWorkflowIds = (workflows: readonly TaskWorkflow[]) => {
  const roles = workflows.flatMap(({ definition }) => definition.roles);
  const notificationDefaults: Record<string, NotificationKindSetting> = {};
  for (const workflow of workflows) {
    for (const [kind, setting] of Object.entries(workflow.notificationDefaults())) {
      if (setting && !(kind in notificationDefaults)) notificationDefaults[kind] = setting;
    }
  }
  return {
    roles: new Set(ids(roles)),
    writeRoles: new Set(ids(roles.filter(({ workspaceAccess }) => workspaceAccess === "write"))),
    templates: new Set(workflows.flatMap(({ prompts }) => ids(prompts.templates))),
    notificationDefaults,
  };
};

/**
 * Checks the settings that task workflows key, and adds the workflow defaults. Settings cover every
 * task workflow of the host, because the tasks of one workspace can follow different workflows.
 * A key outside the workflows fails, so the user fixes the setting.
 */
export const applyGlobalTaskWorkflowSettings = (
  config: GlobalSettings,
  taskWorkflows: TaskWorkflowResolver,
): GlobalSettings => {
  const host = hostWorkflowIds(taskWorkflows.workflows);
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
  requireKnownKeys(
    Object.keys(config.globalPromptOverrides),
    host.templates,
    "globalPromptOverrides",
    "prompt template",
  );

  const notificationKinds = new Set<string>([
    ...AGENT_NOTIFICATION_KIND_VALUES,
    ...Object.keys(host.notificationDefaults),
  ]);
  requireKnownKeys(
    Object.keys(config.notifications.kinds),
    notificationKinds,
    "notifications.kinds",
    "notification",
  );

  const workflows = new Map(
    taskWorkflows.workflows.map((workflow) => [workflow.definition.id, workflow]),
  );
  const rulesByEvent = new Map(
    config.autopilot.rules.map((rule) => [autopilotRuleKey(rule.workflowId, rule.eventId), rule]),
  );
  config.autopilot.rules.forEach((rule, index) => {
    const workflow = workflows.get(rule.workflowId);
    if (!workflow)
      return invalid(
        `autopilot.rules.${index}.workflowId`,
        `Unknown Autopilot workflow "${rule.workflowId}". Use a task workflow of this host.`,
      );
    const signal = workflow.definition.signals.find((value) => value.id === rule.eventId);
    if (!signal) {
      invalid(
        `autopilot.rules.${index}.eventId`,
        `Unknown Autopilot event "${rule.eventId}". Use an event of the task workflow.`,
      );
    }
    requireKnownKeys(
      rule.actionIds,
      new Set(ids(workflow.definition.automations)),
      `autopilot.rules.${index}.actionIds`,
      "Autopilot action",
    );
  });

  return {
    ...config,
    notifications: {
      ...config.notifications,
      kinds: { ...host.notificationDefaults, ...config.notifications.kinds },
    },
    autopilot: {
      ...config.autopilot,
      rules: taskWorkflows.workflows.flatMap((workflow) =>
        workflow.definition.signals.map(
          ({ id: eventId }): AutopilotRule =>
            rulesByEvent.get(autopilotRuleKey(workflow.definition.id, eventId)) ?? {
              workflowId: workflow.definition.id,
              eventId,
              actionIds: [],
            },
        ),
      ),
    },
  };
};

export const validateRepoTaskWorkflowSettings = (
  workspace: RepoConfig,
  taskWorkflows: TaskWorkflowResolver,
): RepoConfig => {
  const host = hostWorkflowIds(taskWorkflows.workflows);
  const field = `workspaces.${workspace.workspaceId}`;
  requireKnownKeys(
    Object.keys(workspace.agentDefaults),
    host.roles,
    `${field}.agentDefaults`,
    "role",
  );
  requireKnownKeys(
    Object.keys(workspace.promptOverrides),
    host.templates,
    `${field}.promptOverrides`,
    "prompt template",
  );
  const activeRole = workspace.agentStudioState.activeTask?.role;
  if (activeRole !== undefined && !host.roles.has(activeRole)) {
    invalid(`${field}.agentStudioState.activeTask.role`, `Unknown role "${activeRole}".`);
  }
  return workspace;
};

export const applyTaskWorkflowSettings = (
  config: GlobalConfig,
  taskWorkflows: TaskWorkflowResolver,
): GlobalConfig => {
  const global = applyGlobalTaskWorkflowSettings(config, taskWorkflows);
  for (const workspace of Object.values(config.workspaces))
    validateRepoTaskWorkflowSettings(workspace, taskWorkflows);
  return { ...global, workspaces: config.workspaces };
};
