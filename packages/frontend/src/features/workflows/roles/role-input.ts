import type {
  AgentRoleDefinition,
  WorkflowProblem,
  WorkflowRoleInput,
} from "@openducktor/contracts";
import { idFromLabel, roleInputOf } from "@openducktor/workflows";

/** What the role form does: create a role, change a custom role, or show a built-in role. */
export type RoleFormMode = "create" | "update" | "view";

const takenIds = (roles: readonly AgentRoleDefinition[]) => new Set(roles.map(({ id }) => id));

/** A new custom role. It can send workflow events and read the workspace. */
export const newRoleInput = (roles: readonly AgentRoleDefinition[]): WorkflowRoleInput => ({
  id: idFromLabel("New role", takenIds(roles)),
  label: "New role",
  tools: [
    "odt_read_task",
    "odt_read_task_artifacts",
    "odt_set_task_artifact",
    "odt_apply_workflow_event",
  ],
  workspaceAccess: "read",
  runtimeScopes: ["task"],
  instructions: "You are the {{role}} agent of task {{task.id}}.",
});

/** A custom copy of a role with a new ID. Model defaults and overrides do not follow it. */
export const duplicateRoleInput = (
  role: AgentRoleDefinition,
  roles: readonly AgentRoleDefinition[],
): WorkflowRoleInput => {
  const label = `${role.label} copy`;
  return { ...roleInputOf(role), id: idFromLabel(label, takenIds(roles)), label };
};

/** The problems of each field, by the first part of the problem path. */
export const problemsByField = (
  problems: readonly WorkflowProblem[],
): ReadonlyMap<string, readonly string[]> => {
  const byField = new Map<string, string[]>();
  for (const problem of problems) {
    const field = String(problem.path[0] ?? "");
    const list = byField.get(field);
    if (list) list.push(problem.message);
    else byField.set(field, [problem.message]);
  }
  return byField;
};
