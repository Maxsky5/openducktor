import type { RawIssue, TaskCard, TaskStatus } from "./contracts";
import { issueToTaskCard } from "./task-mapping";
import { buildTaskIndex, resolveTaskFromIndex } from "./task-resolution";
import { validateTransition } from "./workflow-policy";

export type TaskContext = {
  task: TaskCard;
  tasks: TaskCard[];
};

export type RefreshedTaskState = {
  issue: RawIssue;
  task: TaskCard;
};

export const resolveTaskContext = async (
  taskId: string,
  listTasks: () => Promise<TaskCard[]>,
): Promise<TaskContext> => {
  const tasks = await listTasks();
  const task = resolveTaskFromIndex(buildTaskIndex(tasks), taskId);
  return { task, tasks };
};

export const refreshTaskContext = async (input: {
  taskId: string;
  context?: TaskContext;
  showRawIssue: (taskId: string) => Promise<RawIssue>;
  metadataNamespace: string;
}): Promise<TaskContext> => {
  const issue = await input.showRawIssue(input.taskId);
  const task = issueToTaskCard(issue, input.metadataNamespace);

  if (!input.context) {
    return {
      task,
      tasks: [task],
    };
  }

  const hasTask = input.context.tasks.some((entry) => entry.id === task.id);
  const tasks = hasTask
    ? input.context.tasks.map((entry) => (entry.id === task.id ? task : entry))
    : [...input.context.tasks, task];

  return { task, tasks };
};

export const assertTransitionAllowed = (
  task: TaskCard,
  tasks: TaskCard[],
  nextStatus: TaskStatus,
): void => {
  validateTransition(task, tasks, task.status, nextStatus);
};

export const applyTransition = async (input: {
  task: TaskCard;
  nextStatus: TaskStatus;
  runBdJson: (args: string[]) => Promise<unknown>;
  showRawIssue: (taskId: string) => Promise<RawIssue>;
  invalidateTaskIndex: () => void;
  metadataNamespace: string;
}): Promise<RefreshedTaskState> => {
  if (input.task.status !== input.nextStatus) {
    await input.runBdJson(["update", input.task.id, "--status", input.nextStatus]);
  }

  const issue = await input.showRawIssue(input.task.id);
  input.invalidateTaskIndex();
  return {
    issue,
    task: issueToTaskCard(issue, input.metadataNamespace),
  };
};

export const transitionTask = async (input: {
  taskId: string;
  nextStatus: TaskStatus;
  context?: TaskContext;
  listTasks: () => Promise<TaskCard[]>;
  runBdJson: (args: string[]) => Promise<unknown>;
  showRawIssue: (taskId: string) => Promise<RawIssue>;
  invalidateTaskIndex: () => void;
  metadataNamespace: string;
}): Promise<RefreshedTaskState> => {
  const { task, tasks } =
    input.context ?? (await resolveTaskContext(input.taskId, input.listTasks));
  assertTransitionAllowed(task, tasks, input.nextStatus);

  return applyTransition({
    task,
    nextStatus: input.nextStatus,
    runBdJson: input.runBdJson,
    showRawIssue: input.showRawIssue,
    invalidateTaskIndex: input.invalidateTaskIndex,
    metadataNamespace: input.metadataNamespace,
  });
};
