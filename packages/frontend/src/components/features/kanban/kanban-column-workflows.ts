/** "Used by Bug triage and Spec, Plan, Build". */
export const columnWorkflowsText = (workflows: readonly string[]): string =>
  workflows.length < 2
    ? `Used by ${workflows.join("")}`
    : `Used by ${workflows.slice(0, -1).join(", ")} and ${workflows[workflows.length - 1]}`;
