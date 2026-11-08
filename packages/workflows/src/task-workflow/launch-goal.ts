import { extractPromptTemplatePlaceholders } from "@openducktor/contracts";
import { fillPromptPlaceholders } from "./task-prompts";

type GoalLaunch = {
  readonly context?: "human_feedback" | undefined;
  readonly goal?: { readonly defaultObjective: string } | undefined;
};

const TASK_PLACEHOLDERS: ReadonlySet<string> = new Set(["task.id", "task.title"]);
const FEEDBACK_PLACEHOLDERS: ReadonlySet<string> = new Set([...TASK_PLACEHOLDERS, "humanFeedback"]);

/**
 * The placeholder of a default goal objective that the workflow cannot fill, or `undefined`. A
 * default goal objective can use `{{task.id}}` and `{{task.title}}`. A launch that collects human
 * feedback can also use `{{humanFeedback}}`.
 */
export const unsupportedGoalObjectivePlaceholder = (
  defaultObjective: string,
  context: GoalLaunch["context"],
): string | undefined => {
  const allowed = context === "human_feedback" ? FEEDBACK_PLACEHOLDERS : TASK_PLACEHOLDERS;
  return extractPromptTemplatePlaceholders(defaultObjective).find(
    (placeholder) => !allowed.has(placeholder),
  );
};

/** The default goal objective of a launch action for a task, or `undefined` without Goal mode. */
export const launchGoalObjective = (
  launch: GoalLaunch,
  task: { readonly id: string; readonly title: string },
  humanFeedback?: string,
): string | undefined =>
  launch.goal &&
  fillPromptPlaceholders(
    launch.goal.defaultObjective,
    new Map([
      ["task.id", task.id],
      ["task.title", task.title],
      ["humanFeedback", humanFeedback?.trim() ?? ""],
    ]),
  ).trim();
