import type { TaskCard, TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import { TaskPolicyError } from "./task-policy-error";

export const normalizedParentId = (task: TaskCreateInput): string | undefined => {
  const trimmed = task.parentId?.trim();
  return trimmed ? trimmed : undefined;
};

export const validateParentRelationshipsForCreate = (
  tasks: TaskCard[],
  input: TaskCreateInput,
): void => {
  const parentId = normalizedParentId(input);
  if (input.issueType === "epic" && parentId !== undefined) {
    throw TaskPolicyError.policy("Epics cannot be created as subtasks.");
  }

  if (parentId === undefined) {
    return;
  }

  const parent = tasks.find((task) => task.id === parentId);
  if (!parent) {
    throw TaskPolicyError.policy(`Task not found: ${parentId}`);
  }
  if (parent.issueType !== "epic") {
    throw TaskPolicyError.policy("Only epics can have subtasks.");
  }
  if (parent.parentId !== undefined) {
    throw TaskPolicyError.policy("Subtask depth is limited to one level.");
  }
};

export const nextParentIdForUpdate = (
  current: TaskCard,
  patch: TaskUpdatePatch,
): string | undefined => {
  if (patch.parentId === undefined) {
    return current.parentId;
  }

  const trimmed = patch.parentId.trim();
  return trimmed ? trimmed : undefined;
};

export const validateParentRelationshipsForUpdate = (
  tasks: TaskCard[],
  current: TaskCard,
  patch: TaskUpdatePatch,
): void => {
  const nextIssueType = patch.issueType ?? current.issueType;
  const nextParentId = nextParentIdForUpdate(current, patch);

  if (nextIssueType === "epic" && nextParentId !== undefined) {
    throw TaskPolicyError.policy("Epics cannot be converted to subtasks.");
  }

  const hasDirectSubtasks = tasks.some((task) => task.parentId === current.id);
  if (hasDirectSubtasks && nextParentId !== undefined) {
    throw TaskPolicyError.policy("Tasks with subtasks cannot become subtasks.");
  }
  if (hasDirectSubtasks && nextIssueType !== "epic") {
    throw TaskPolicyError.policy("Only epics can have subtasks.");
  }

  if (nextParentId === undefined) {
    return;
  }

  const parent = tasks.find((task) => task.id === nextParentId);
  if (!parent) {
    throw TaskPolicyError.policy(`Task not found: ${nextParentId}`);
  }
  if (parent.issueType !== "epic") {
    throw TaskPolicyError.policy("Only epics can be selected as parents.");
  }
  if (parent.parentId !== undefined) {
    throw TaskPolicyError.policy("Subtask depth is limited to one level.");
  }
};
