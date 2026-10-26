import type { TaskCard } from "@openducktor/contracts";
import type { TaskWorkflowAction } from "../board/kanban-task-workflow";
import { toDisplayTaskLabels } from "../presentation/task-labels";

export const toTaskLabels = toDisplayTaskLabels;

export const toSubtasks = (task: TaskCard | null, taskById: Map<string, TaskCard>): TaskCard[] => {
  if (!task) {
    return [];
  }

  return task.subtaskIds.reduce<TaskCard[]>((subtasks, subtaskId) => {
    const subtask = taskById.get(subtaskId);
    if (subtask) {
      subtasks.push(subtask);
    }
    return subtasks;
  }, []);
};

/** True when the task details show the Subtasks card. Only an epic has subtasks. */
export const showsTaskSubtasks = (task: Pick<TaskCard, "issueType"> | null): boolean =>
  task?.issueType === "epic";

export const collectDeleteImpactTaskIds = (
  task: TaskCard | null,
  taskById: Map<string, TaskCard>,
): string[] => {
  if (!task) {
    return [];
  }

  const collectedIds: string[] = [];
  const pendingIds = [task.id];
  const seenIds = new Set<string>();

  while (pendingIds.length > 0) {
    const currentId = pendingIds.shift();
    if (!currentId || seenIds.has(currentId)) {
      continue;
    }

    seenIds.add(currentId);
    collectedIds.push(currentId);

    const currentTask = taskById.get(currentId);
    if (!currentTask) {
      continue;
    }

    for (const subtaskId of currentTask.subtaskIds) {
      if (!seenIds.has(subtaskId)) {
        pendingIds.push(subtaskId);
      }
    }
  }

  return collectedIds;
};

export const collectSingleTaskCleanupImpactTaskIds = (task: TaskCard | null): string[] => {
  if (!task) {
    return [];
  }

  return [task.id];
};

/** The workflow actions that task details offer. Close Task shows only here. */
export const TASK_DETAILS_WORKFLOW_ACTIONS: readonly TaskWorkflowAction[] = [
  "set_spec",
  "set_plan",
  "open_spec",
  "open_planner",
  "qa_start",
  "build_start",
  "open_builder",
  "open_qa",
  "human_approve",
  "human_request_changes",
  "reset_implementation",
  "reset_task",
  "close_task",
];

/** The titles and empty texts of the task document sections. */
export const TASK_DOCUMENT_SECTION_COPY = {
  description: { title: "Description", empty: "No description yet." },
  spec: { title: "Specification", empty: "No specification yet." },
  plan: { title: "Implementation Plan", empty: "No implementation plan yet." },
  qa: { title: "QA Reports", empty: "No QA report yet." },
} as const;

/** The titles and empty texts of the document panel of a session. It shows the latest QA report. */
export const SESSION_DOCUMENT_PANEL_COPY = {
  spec: { title: "Specification", empty: "No spec document yet." },
  plan: { title: "Implementation Plan", empty: "No implementation plan yet." },
  qa: { title: "QA Report", empty: "No QA report yet." },
} as const;
