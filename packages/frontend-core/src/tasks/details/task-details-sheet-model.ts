import { actionShowsOn } from "@openducktor/workflows";
import type { ResolvedTaskCard as TaskCard, TaskWorkflowAction } from "@openducktor/workflows";
import { toDisplayTaskLabels } from "../presentation/task-labels";

export const toTaskLabels = toDisplayTaskLabels;

export const collectSingleTaskCleanupImpactTaskIds = (task: TaskCard | null): string[] => {
  if (!task) {
    return [];
  }

  return [task.id];
};

/** Details use declared surfaces and keep cleanup behind its existing worktree read. */
export const taskDetailsWorkflowActions = (
  canRemoveWorktree: boolean,
  task: TaskCard,
): readonly TaskWorkflowAction[] =>
  task.taskWorkflow.definition.actions
    .filter(
      (action) =>
        actionShowsOn(action, "details") &&
        (canRemoveWorktree || action.kind !== "view" || action.target !== "worktree_cleanup"),
    )
    .map(({ id }) => id);

/** The title and empty text of the task description section. */
export const TASK_DOCUMENT_SECTION_COPY = {
  description: { title: "Description", empty: "No description yet." },
} as const;
