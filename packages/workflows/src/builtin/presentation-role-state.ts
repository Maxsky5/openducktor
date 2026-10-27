import type { AgentWorkflowState } from "@openducktor/contracts";
import type { BuiltinTaskCard } from "./task-card";
import { BUILTIN_STEPS, BUILTIN_TERMINAL_STATUSES } from "./definition";
import type { BuiltinRoleId } from "./ids";

/** Without a task, only unconditionally required steps count as required. */
const NO_TASK_WORKFLOWS = new Map(
  BUILTIN_STEPS.map((step): [BuiltinRoleId, AgentWorkflowState] => [
    step.roleId,
    {
      required: step.requiredWhen === true,
      canSkip: step.requiredWhen !== true,
      available: false,
      completed: false,
    },
  ]),
);

export const roleWorkflowForTask = (
  task: BuiltinTaskCard | null | undefined,
  role: BuiltinRoleId,
): AgentWorkflowState => {
  if (!task) {
    const workflow = NO_TASK_WORKFLOWS.get(role);
    if (!workflow) throw new Error(`The built-in workflow has no step for role ${role}.`);
    return { ...workflow };
  }

  return task.agentWorkflows[role];
};

export const buildRoleWorkflowMapForTask = (task: BuiltinTaskCard | null | undefined) =>
  ({
    spec: roleWorkflowForTask(task, "spec"),
    planner: roleWorkflowForTask(task, "planner"),
    build: roleWorkflowForTask(task, "build"),
    qa: roleWorkflowForTask(task, "qa"),
  }) satisfies Record<BuiltinRoleId, AgentWorkflowState>;

export const isRoleAvailableForTask = (
  task: BuiltinTaskCard | null | undefined,
  role: BuiltinRoleId,
): boolean => {
  return roleWorkflowForTask(task, role).available;
};

/** The artifact that a role session shows first: its step output, else its last step input. */
export const roleFocusArtifact = (role: BuiltinRoleId): string | undefined => {
  const step = BUILTIN_STEPS.find((candidate) => candidate.roleId === role);
  return step?.outputs[0] ?? step?.inputs.at(-1);
};

export const taskHasSessionPage = (task: Pick<BuiltinTaskCard, "status">): boolean =>
  !BUILTIN_TERMINAL_STATUSES.includes(task.status);

export const taskNeedsInput = (task: Pick<BuiltinTaskCard, "status">): boolean =>
  task.status === "blocked";
