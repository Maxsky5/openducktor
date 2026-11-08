import { extractPromptTemplatePlaceholders } from "@openducktor/contracts";
import { fillPromptPlaceholders } from "./task-prompts";

type GoalLaunch = {
  readonly context?: "human_feedback" | undefined;
  readonly goal?: { readonly defaultObjective: string } | undefined;
};

const goalObjectivePlaceholders = (launch: GoalLaunch): ReadonlySet<string> =>
  new Set(
    launch.context === "human_feedback"
      ? ["task.id", "task.title", "humanFeedback"]
      : ["task.id", "task.title"],
  );

/**
 * The placeholder of a default goal objective that the workflow cannot fill, or `undefined`. A
 * default goal objective can use `{{task.id}}` and `{{task.title}}`. A launch that collects human
 * feedback can also use `{{humanFeedback}}`.
 */
export const unsupportedGoalObjectivePlaceholder = (
  launch: GoalLaunch & { readonly goal: { readonly defaultObjective: string } },
): string | undefined => {
  const allowed = goalObjectivePlaceholders(launch);
  return extractPromptTemplatePlaceholders(launch.goal.defaultObjective).find(
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
