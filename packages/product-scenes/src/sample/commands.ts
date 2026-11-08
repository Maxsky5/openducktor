// The custom reusable prompts of the sample workspace. The chat scene and the composer scene show
// them in the slash menu. The prompts are fictional.

/** Custom reusable prompts whose trigger starts with `tasks-`, in catalog order. */
export const COMMANDS = [
  {
    trigger: "tasks-from-request",
    description: "Split a request into tasks that each fit in one pull request.",
  },
  {
    trigger: "tasks-from-bug",
    description: "Write a bug task with the steps to reproduce and the expected result.",
  },
  {
    trigger: "tasks-cleanup",
    description: "Find duplicate and stale tasks in the backlog.",
  },
];
