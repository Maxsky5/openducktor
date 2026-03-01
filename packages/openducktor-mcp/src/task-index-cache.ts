import type { TaskCard } from "./contracts";
import {
  buildTaskIndex,
  resolveTaskFromIndex,
  type TaskIndex,
  TaskResolutionAmbiguousError,
  TaskResolutionNotFoundError,
} from "./task-resolution";

export type TaskListLoader = () => Promise<TaskCard[]>;

export class TaskIndexCache {
  private readonly listTasks: TaskListLoader;
  private taskIndex: TaskIndex | null;
  private taskIndexBuildPromise: Promise<TaskIndex> | null;

  constructor(listTasks: TaskListLoader) {
    this.listTasks = listTasks;
    this.taskIndex = null;
    this.taskIndexBuildPromise = null;
  }

  async refresh(): Promise<TaskIndex> {
    const tasks = await this.listTasks();
    const next = buildTaskIndex(tasks);
    this.taskIndex = next;
    return next;
  }

  async getOrBuild(): Promise<TaskIndex> {
    if (this.taskIndex) {
      return this.taskIndex;
    }

    if (this.taskIndexBuildPromise) {
      return this.taskIndexBuildPromise;
    }

    this.taskIndexBuildPromise = this.refresh();
    try {
      return await this.taskIndexBuildPromise;
    } finally {
      this.taskIndexBuildPromise = null;
    }
  }

  invalidate(): void {
    this.taskIndex = null;
    this.taskIndexBuildPromise = null;
  }

  async resolveTask(taskId: string): Promise<TaskCard> {
    const index = await this.getOrBuild();

    try {
      return resolveTaskFromIndex(index, taskId);
    } catch (error) {
      const shouldRefreshIndex =
        error instanceof TaskResolutionNotFoundError ||
        error instanceof TaskResolutionAmbiguousError;
      if (!shouldRefreshIndex) {
        throw error;
      }

      const refreshedIndex = await this.refresh();
      return resolveTaskFromIndex(refreshedIndex, taskId);
    }
  }
}
