import type { TaskCard } from "@openducktor/contracts";

export const toVisibleTasks = (taskList: TaskCard[]): TaskCard[] =>
  taskList.filter((task) => task.status !== "deferred");
