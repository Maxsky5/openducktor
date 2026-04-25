import type { AgentWorkflowState, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";

const DEFAULT_WORKFLOW_BY_ROLE: Record<AgentRole, AgentWorkflowState> = {
  spec: {
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  },
  planner: {
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  },
  build: {
    required: true,
    canSkip: false,
    available: false,
    completed: false,
  },
  qa: {
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  },
};

const toBuildRoleWorkflow = (task: TaskCard): AgentWorkflowState => task.agentWorkflows.builder;

export const roleWorkflowForTask = (
  task: TaskCard | null | undefined,
  role: AgentRole,
): AgentWorkflowState => {
  if (!task) {
    return { ...DEFAULT_WORKFLOW_BY_ROLE[role] };
  }

  if (role === "build") {
    return toBuildRoleWorkflow(task);
  }
  return task.agentWorkflows[role];
};

export const buildRoleWorkflowMapForTask = (
  task: TaskCard | null | undefined,
): Record<AgentRole, AgentWorkflowState> => ({
  spec: roleWorkflowForTask(task, "spec"),
  planner: roleWorkflowForTask(task, "planner"),
  build: roleWorkflowForTask(task, "build"),
  qa: roleWorkflowForTask(task, "qa"),
});

export const isRoleAvailableForTask = (
  task: TaskCard | null | undefined,
  role: AgentRole,
): boolean => {
  return roleWorkflowForTask(task, role).available;
};

export const unavailableRoleErrorMessage = (task: TaskCard, role: AgentRole): string => {
  return `Role '${role}' is unavailable for task '${task.id}' in status '${task.status}'.`;
};
