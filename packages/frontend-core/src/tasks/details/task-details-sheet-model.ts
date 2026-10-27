import type { BuiltinTaskCard as TaskCard, TaskWorkflowAction } from "@openducktor/workflows";
import { toDisplayTaskLabels } from "../presentation/task-labels";

export const toTaskLabels = toDisplayTaskLabels;

export const collectSingleTaskCleanupImpactTaskIds = (task: TaskCard | null): string[] => {
  if (!task) {
    return [];
  }

  return [task.id];
};

/** The workflow actions that task details offer. */
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

const TASK_DETAILS_ACTIONS_WITH_WORKTREE_REMOVAL: readonly TaskWorkflowAction[] = [
  ...TASK_DETAILS_WORKFLOW_ACTIONS,
  "remove_worktree",
];

/** A closed task shows Remove Worktree only while its worktree or task branch remains. */
export const taskDetailsWorkflowActions = (
  canRemoveWorktree: boolean,
): readonly TaskWorkflowAction[] =>
  canRemoveWorktree ? TASK_DETAILS_ACTIONS_WITH_WORKTREE_REMOVAL : TASK_DETAILS_WORKFLOW_ACTIONS;

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
