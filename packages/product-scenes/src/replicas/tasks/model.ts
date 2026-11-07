// The data of a task that the task sheet and the task result card show.
import type { Task, TaskKey } from "../../sample/tasks";

/** A task that the chat creates, with the description, the labels, and the time of its tool call. */
export type ChatTask = Task & {
  id: TaskKey;
  description: string;
  labels: string[];
  time: string;
};
