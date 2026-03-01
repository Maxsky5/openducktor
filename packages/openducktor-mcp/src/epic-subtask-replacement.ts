import type { PlanSubtaskInput, TaskCard } from "./contracts";
import { normalizeTitleKey } from "./task-resolution";
import {
  assertNoValidationError,
  canReplaceEpicSubtaskStatus,
  getSetPlanError,
  validatePlanSubtaskRules,
} from "./workflow-policy";

export type EpicSubtaskReplacement = {
  latestTask: TaskCard;
  existingDirectSubtasks: TaskCard[];
};

export type EpicSubtaskReplacementDeps = {
  listTasks: () => Promise<TaskCard[]>;
  createSubtask: (parentTaskId: string, subtask: PlanSubtaskInput) => Promise<string>;
  deleteTask: (taskId: string) => Promise<void>;
};

export class EpicSubtaskReplacementService {
  private readonly deps: EpicSubtaskReplacementDeps;

  constructor(deps: EpicSubtaskReplacementDeps) {
    this.deps = deps;
  }

  async prepareReplacement(
    task: TaskCard,
    normalizedSubtasks: PlanSubtaskInput[],
  ): Promise<EpicSubtaskReplacement> {
    const latestTasks = await this.deps.listTasks();
    const latestTask = latestTasks.find((entry) => entry.id === task.id);
    if (!latestTask) {
      throw new Error(`Task not found: ${task.id}`);
    }

    assertNoValidationError(getSetPlanError(latestTask));
    validatePlanSubtaskRules(latestTask, latestTasks, normalizedSubtasks);

    const existingDirectSubtasks = latestTasks.filter((entry) => entry.parentId === task.id);
    const blockedSubtasks = existingDirectSubtasks.filter(
      (entry) => !canReplaceEpicSubtaskStatus(entry.status),
    );
    if (blockedSubtasks.length > 0) {
      const blockedSummary = blockedSubtasks
        .map((entry) => `${entry.id} (${entry.status})`)
        .join(", ");
      throw new Error(
        "Cannot replace epic subtasks while active work exists. " +
          `Move subtasks to open/spec_ready/ready_for_dev first: ${blockedSummary}`,
      );
    }

    return { latestTask, existingDirectSubtasks };
  }

  async applyReplacement(
    task: TaskCard,
    existingDirectSubtasks: TaskCard[],
    normalizedSubtasks: PlanSubtaskInput[],
  ): Promise<string[]> {
    for (const existingSubtask of existingDirectSubtasks) {
      await this.deps.deleteTask(existingSubtask.id);
    }

    const createdSubtaskIds: string[] = [];
    const createdTitleKeys = new Set<string>();
    for (const subtask of normalizedSubtasks) {
      const key = normalizeTitleKey(subtask.title);
      if (createdTitleKeys.has(key)) {
        continue;
      }

      const createdId = await this.deps.createSubtask(task.id, subtask);
      createdSubtaskIds.push(createdId);
      createdTitleKeys.add(key);
    }

    return createdSubtaskIds;
  }
}
