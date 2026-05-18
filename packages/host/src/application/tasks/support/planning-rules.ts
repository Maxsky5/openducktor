import type { TaskCard, TaskCreateInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { validateParentRelationshipsForCreate } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
export const replaceEpicPlanSubtasks = (
  taskStore: TaskStorePort,
  repoPath: string,
  task: TaskCard,
  currentTasks: TaskCard[],
  subtaskCreates: TaskCreateInput[],
) =>
  Effect.gen(function* () {
    const directSubtasks = currentTasks.filter((entry) => entry.parentId === task.id);
    for (const subtask of directSubtasks) {
      yield* taskStore.deleteTask({ repoPath, taskId: subtask.id, deleteSubtasks: false });
    }
    const remainingTasks = currentTasks.filter((entry) => entry.parentId !== task.id);
    const proposalTitles = new Set<string>();
    for (const createInput of subtaskCreates) {
      const titleKey = createInput.title.trim().toLowerCase();
      if (proposalTitles.has(titleKey)) {
        continue;
      }
      proposalTitles.add(titleKey);
      const taskInput = { ...createInput, parentId: task.id };
      yield* Effect.try({
        try: () => validateParentRelationshipsForCreate(remainingTasks, taskInput),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const created = yield* taskStore.createTask({ repoPath, task: taskInput });
      remainingTasks.push(created);
    }
  });
