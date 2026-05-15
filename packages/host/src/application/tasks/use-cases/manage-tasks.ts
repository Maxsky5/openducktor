import {
  validateParentRelationshipsForCreate,
  validateParentRelationshipsForUpdate,
  validateTransition,
} from "../../../domain/task";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskCrudUseCases = ({
  taskStore,
}: CreateTaskServiceInput): Pick<TaskService, "createTask" | "updateTask" | "transitionTask"> => ({
  async createTask(input) {
    const { repoPath, task } = input;
    const currentTasks = await taskStore.listTasks({ repoPath });
    validateParentRelationshipsForCreate(currentTasks, task);
    const created = await taskStore.createTask({ repoPath, task });

    return enrichTask(created, [...currentTasks, created]);
  },

  async updateTask(input) {
    const { repoPath, taskId, patch } = input;
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    validateParentRelationshipsForUpdate(currentTasks, current, patch);
    const updated = await taskStore.updateTask({ repoPath, taskId, patch });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async transitionTask(input) {
    const { repoPath, taskId, status } = input;
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    validateTransition(current, currentTasks, current.status, status);

    if (current.status === status) {
      return enrichTask(current, currentTasks);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },
});
