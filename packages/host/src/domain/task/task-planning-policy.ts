import type { PlanSubtaskInput, TaskCard, TaskCreateInput } from "@openducktor/contracts";
import { canReplaceEpicSubtaskStatus } from "./status-transition-policy";

export const normalizePlanSubtasks = (inputs: PlanSubtaskInput[]): TaskCreateInput[] =>
  inputs.map((input) => {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Subtask proposals require a non-empty title.");
    }

    const issueType = input.issueType ?? "task";
    const description = input.description?.trim();
    return {
      title,
      issueType,
      priority: input.priority ?? 2,
      description: description ? description : undefined,
      aiReviewEnabled: true,
    };
  });

export const validatePlanSubtaskRules = (
  task: TaskCard,
  allTasks: TaskCard[],
  planSubtasks: TaskCreateInput[],
): void => {
  if (task.issueType !== "epic") {
    if (planSubtasks.length > 0) {
      throw new Error("Only epics can receive subtask proposals during planning.");
    }
    return;
  }

  const hasDirectSubtasks = allTasks.some((entry) => entry.parentId === task.id);
  if (!hasDirectSubtasks && planSubtasks.length === 0) {
    throw new Error("Epic plans must provide at least one direct subtask proposal.");
  }
};

export const validateEpicSubtasksReplaceable = (task: TaskCard, allTasks: TaskCard[]): void => {
  const blockedSubtasks = allTasks
    .filter((entry) => entry.parentId === task.id)
    .filter((entry) => !canReplaceEpicSubtaskStatus(entry.status))
    .map((entry) => `${entry.id} (${entry.status})`);

  if (blockedSubtasks.length > 0) {
    throw new Error(
      `Cannot replace epic subtasks while active work exists. Move subtasks to open/spec_ready/ready_for_dev first: ${blockedSubtasks.join(", ")}`,
    );
  }
};
