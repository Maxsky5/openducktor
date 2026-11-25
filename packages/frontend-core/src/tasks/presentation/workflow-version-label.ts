import { BUILTIN_WORKFLOW_ID, type TaskWorkflow } from "@openducktor/workflows";

/** The version of a workflow: "Built-in" for the built-in workflow, else "v3". */
export const workflowVersionLabel = (workflow: TaskWorkflow): string =>
  workflow.reference.id === BUILTIN_WORKFLOW_ID ? "Built-in" : `v${workflow.reference.revision}`;

/** The name and version of a workflow, such as "Spec, Plan, Build · Built-in" or "My flow · v3". */
export const workflowNameAndVersion = (workflow: TaskWorkflow): string =>
  `${workflow.definition.label} · ${workflowVersionLabel(workflow)}`;
