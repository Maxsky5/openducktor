export type GoalTaskMaterial = {
  readonly task: { readonly id: string; readonly title: string; readonly description: string };
  /** The default goal of the launch, which the generated goal refines. */
  readonly defaultObjective: string;
  /** The workflow artifacts of the task that have content, such as the spec and the plan. */
  readonly artifacts: readonly { readonly label: string; readonly markdown: string }[];
};

/**
 * The task material that a goal prompt works from, in a `<task_material>` block. The goal prompt
 * of the workflow tells the model to read the block as data.
 */
export const goalTaskMaterial = ({ task, defaultObjective, artifacts }: GoalTaskMaterial) =>
  [
    "<task_material>",
    `# Task ${task.id}: ${task.title}`,
    task.description.trim() || "The task has no description.",
    ...artifacts.flatMap(({ label, markdown }) => [`# ${label}`, markdown.trim()]),
    "# Default goal",
    defaultObjective,
    "</task_material>",
    "Write the goal for this task.",
  ].join("\n\n");
