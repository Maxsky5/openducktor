import {
  type BoardTaskOrder,
  type IssueType,
  type SharedBoardState,
  type TaskCard,
  type WorkflowInput,
  type WorkflowStepProjection,
  type WorkspaceWorkflowContext,
} from "@openducktor/contracts";
import {
  requireCatalogWorkflow,
  workflowReferenceKey,
  type CompiledWorkflowCatalog,
} from "./workflow-catalog";
import type { TaskWorkflow } from "./task-workflow/task-workflow";

/**
 * A client read model: a wire task card joined to its compiled workflow and its board column.
 * Steps carry their declaration with the host flags. None of it belongs to stored task data.
 */
export type ResolvedTaskCard = Omit<TaskCard, "workflowSteps"> & {
  workflowSteps: WorkflowStepProjection[];
  taskWorkflow: TaskWorkflow;
  sharedState: SharedBoardState;
};
export type WorkflowRoleId = string;
export type WorkflowIssueTypeId = IssueType;
export type WorkflowLaunchActionId = string;
export type WorkflowDocumentCode = string;
export type WorkflowPromptRoleTabId = string;
export type WorkflowPromptTemplateId = string;

export const taskWorkflowInput = (
  task: Pick<ResolvedTaskCard, "workflow" | "status" | "issueType" | "artifactSummary">,
): WorkflowInput => ({
  workflowId: task.workflow.id,
  definitionRevision: task.workflow.revision,
  state: task.status,
  facts: { issueType: task.issueType },
  artifacts: task.artifactSummary,
});

export const compareBoardTasks = (
  left: Pick<TaskCard, "id" | "priority" | "createdAt" | "updatedAt">,
  right: Pick<TaskCard, "id" | "priority" | "createdAt" | "updatedAt">,
  order: BoardTaskOrder,
): number => {
  const compared =
    order === "priority_then_created"
      ? left.priority - right.priority || Date.parse(right.createdAt) - Date.parse(left.createdAt)
      : Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  return compared || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
};

/**
 * Joins wire task projections to their exact compiled workflow and shared board state. The host
 * computes every projection from the same definition, so a mismatch means a broken host.
 */
export const resolveWorkflowTaskCards = (
  catalog: CompiledWorkflowCatalog,
  context: WorkspaceWorkflowContext,
  cards: readonly TaskCard[],
): ResolvedTaskCard[] => {
  const known = new Set(context.workflows.map(workflowReferenceKey));
  const states = new Map(context.board.states.map((state) => [state.id, state]));
  // Each transport already parsed the cards with taskCardSchema.
  return cards.map((card) => {
    const reference = workflowReferenceKey(card.workflow);
    if (!known.has(reference))
      throw new Error(
        `Task "${card.id}" references workflow "${reference}" outside this workspace. Fix the host inventory.`,
      );
    const taskWorkflow = requireCatalogWorkflow(catalog, card.workflow);
    const fail = (message: string): never => {
      throw new Error(
        `Task "${card.id}" has an invalid projection for workflow "${reference}". ${message} Reload the workspace or update the host.`,
      );
    };
    if (!taskWorkflow.issueTypes.includes(card.issueType))
      fail(`Unknown issue type "${card.issueType}".`);
    const projected = new Map(card.workflowSteps.map((step) => [step.id, step]));
    const { steps } = taskWorkflow.definition;
    if (projected.size !== card.workflowSteps.length || projected.size !== steps.length)
      fail("Step IDs do not match the definition.");
    const workflowSteps = steps.map((step): WorkflowStepProjection => {
      const flags = projected.get(step.id) ?? fail(`Step "${step.id}" is missing.`);
      const view = {
        id: step.id,
        label: step.label,
        inputs: step.inputs,
        outputs: step.outputs,
        required: flags.required,
        available: flags.available,
        completed: flags.completed,
      };
      return step.kind === "agent"
        ? { ...view, kind: "agent", roleId: step.roleId }
        : { ...view, kind: "human" };
    });
    const sharedState = states.get(card.status);
    if (!sharedState || !taskWorkflow.definition.states.some(({ id }) => id === card.status))
      throw new Error(
        `Task "${card.id}" uses missing board or workflow state "${card.status}". Fix the host board.`,
      );
    return { ...card, workflowSteps, taskWorkflow, sharedState };
  });
};
