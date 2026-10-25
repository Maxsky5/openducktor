import {
  AGENT_NOTIFICATION_KIND_VALUES,
  type AutopilotRule,
  type GlobalConfig,
  type NotificationKindSetting,
} from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { HostValidationError } from "../effect/host-errors";
import type { TaskWorkflowResolver } from "../ports/task-workflow-port";

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
  const signals = [...new Set(workflows.flatMap(({ definition }) => ids(definition.signals)))];
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
    signals,
    automations: new Set(workflows.flatMap(({ definition }) => ids(definition.automations))),
    notificationDefaults,
  };
};

/**
 * Checks the settings that task workflows key, and adds the workflow defaults. Global settings
 * cover every task workflow of the host. Workspace settings follow the workflow of the workspace.
 * A key outside the workflows fails, so the user fixes the setting.
 */
export const applyTaskWorkflowSettings = (
  config: GlobalConfig,
  taskWorkflows: TaskWorkflowResolver,
): GlobalConfig => {
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

  const rulesByEvent = new Map(config.autopilot.rules.map((rule) => [rule.eventId, rule]));
  const signals = new Set(host.signals);
  config.autopilot.rules.forEach((rule, index) => {
    if (!signals.has(rule.eventId)) {
      invalid(
        `autopilot.rules.${index}.eventId`,
        `Unknown Autopilot event "${rule.eventId}". Use an event of the task workflow.`,
      );
    }
    requireKnownKeys(
      rule.actionIds,
      host.automations,
      `autopilot.rules.${index}.actionIds`,
      "Autopilot action",
    );
  });

  for (const [workspaceId, workspace] of Object.entries(config.workspaces)) {
    const workflow = taskWorkflows.forRepo(workspace.repoPath);
    const roles = new Set(ids(workflow.definition.roles));
    const field = `workspaces.${workspaceId}`;
    requireKnownKeys(Object.keys(workspace.agentDefaults), roles, `${field}.agentDefaults`, "role");
    requireKnownKeys(
      Object.keys(workspace.promptOverrides),
      new Set(ids(workflow.prompts.templates)),
      `${field}.promptOverrides`,
      "prompt template",
    );
    const activeRole = workspace.agentStudioState.activeTask?.role;
    if (activeRole !== undefined && !roles.has(activeRole)) {
      invalid(`${field}.agentStudioState.activeTask.role`, `Unknown role "${activeRole}".`);
    }
  }

  return {
    ...config,
    notifications: {
      ...config.notifications,
      kinds: { ...host.notificationDefaults, ...config.notifications.kinds },
    },
    autopilot: {
      ...config.autopilot,
      rules: host.signals.map(
        (eventId): AutopilotRule => rulesByEvent.get(eventId) ?? { eventId, actionIds: [] },
      ),
    },
  };
};
