import { TASK_OPEN_STATE } from "@openducktor/contracts";
import type { TaskWorkflow, WorkflowIssueTypeId as IssueType } from "@openducktor/workflows";

/** One stage of work of a new task, as the preview of a workflow shows it. */
export type NewTaskStep = {
  readonly id: string;
  readonly label: string;
  /** The role of an agent step, or null for a step that a person does. */
  readonly roleId: string | null;
  /** A new task of the type can skip the step. */
  readonly optional: boolean;
};

/** The steps that a new task of `issueType` goes through in `workflow`, in workflow order. */
export const newTaskSteps = (workflow: TaskWorkflow, issueType: IssueType): NewTaskStep[] => {
  const definitions = new Map(workflow.definition.steps.map((step) => [step.id, step]));
  const { workflowSteps } = workflow.project({
    id: "new-task",
    status: TASK_OPEN_STATE,
    issueType,
    artifactSummary: workflow.emptyArtifactSummary(),
  });
  return workflowSteps.flatMap(({ id, required }): NewTaskStep[] => {
    const step = definitions.get(id);
    if (!step) return [];
    return [
      {
        id,
        label: step.label || id,
        roleId: step.kind === "agent" ? step.roleId : null,
        optional: !required,
      },
    ];
  });
};
