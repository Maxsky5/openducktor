import { extractPromptTemplatePlaceholders } from "@openducktor/contracts";

const GOAL_OBJECTIVE_PLACEHOLDERS = new Set(["task.id", "task.title"]);

/**
 * The placeholder of a default goal objective that the workflow cannot fill, or `undefined`.
 * A default goal objective can use only `{{task.id}}` and `{{task.title}}`.
 */
export const unsupportedGoalObjectivePlaceholder = (template: string): string | undefined =>
  extractPromptTemplatePlaceholders(template).find(
    (placeholder) => !GOAL_OBJECTIVE_PLACEHOLDERS.has(placeholder),
  );

/** The default goal objective of a launch action for a task, or `undefined` without Goal mode. */
export const launchGoalObjective = (
  launch: { readonly goal?: { readonly defaultObjective: string } | undefined },
  task: { readonly id: string; readonly title: string },
): string | undefined =>
  launch.goal?.defaultObjective.replace(/{{\s*(task\.id|task\.title)\s*}}/g, (_, name: string) =>
    name === "task.id" ? task.id : task.title,
  );
