import type { TaskCard, TaskCreateInput } from "@openducktor/contracts";
import { validateParentRelationshipsForCreate } from "../../../domain/task";
import type { TaskStorePort } from "../../../ports/task-repository-ports";

export const replaceEpicPlanSubtasks = async (
  taskStore: TaskStorePort,
  repoPath: string,
  task: TaskCard,
  currentTasks: TaskCard[],
  subtaskCreates: TaskCreateInput[],
): Promise<void> => {
  const directSubtasks = currentTasks.filter((entry) => entry.parentId === task.id);
  for (const subtask of directSubtasks) {
    await taskStore.deleteTask({ repoPath, taskId: subtask.id, deleteSubtasks: false });
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
    validateParentRelationshipsForCreate(remainingTasks, taskInput);
    const created = await taskStore.createTask({ repoPath, task: taskInput });
    remainingTasks.push(created);
  }
};
