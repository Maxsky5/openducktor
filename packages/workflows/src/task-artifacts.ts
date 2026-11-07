import type { TaskWorkflow } from "./task-workflow/task-workflow";

export const workflowArtifactLabel = (code: string, workflow: TaskWorkflow): string =>
  workflow.artifact(code)?.label ?? code;
export const workflowArtifactShortLabel = (code: string, workflow: TaskWorkflow): string => {
  const artifact = workflow.artifact(code);
  return artifact?.shortLabel ?? artifact?.label ?? code;
};
export const workflowArtifactOrder = (code: string, workflow: TaskWorkflow): number => {
  const index = workflow.definition.artifacts.findIndex(({ id }) => id === code);
  return index < 0 ? workflow.definition.artifacts.length : index;
};
export const workflowArtifactRole = (code: string, workflow: TaskWorkflow): string | undefined => {
  const step = workflow.definition.steps.find(
    (step) => step.kind === "agent" && step.outputs.includes(code),
  );
  return step?.kind === "agent" ? step.roleId : undefined;
};
export const workflowArtifactVerdict = (code: string, verdict: string, workflow: TaskWorkflow) => {
  const artifact = workflow.artifact(code);
  return artifact?.kind === "review"
    ? artifact.verdicts.find(({ id }) => id === verdict)
    : undefined;
};
export const isEditableWorkflowDocument = (code: string, workflow: TaskWorkflow): boolean =>
  workflow.artifact(code)?.kind === "document";
export const workflowDocumentPlaceholder = (code: string, workflow: TaskWorkflow): string => {
  const artifact = workflow.artifact(code);
  return artifact?.kind === "document" ? (artifact.placeholder ?? "") : "";
};
