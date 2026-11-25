import type {
  WorkflowIssueTypeId as IssueType,
  ResolvedTaskCard as TaskCard,
  TaskWorkflow,
} from "@openducktor/workflows";
import { type Dispatch, useCallback, useMemo } from "react";
import { useTaskFormWorkflow } from "../../queries/use-task-form-workflow";
import { issueTypeChoicesOf } from "./task-composer-options";
import type { ComposerStep } from "./task-composer-types";
import type { TaskCreateModalAction } from "./task-create-modal-state";

const NO_WORKFLOWS: readonly TaskWorkflow[] = [];

const WITH_WORKFLOW_STEP: readonly ComposerStep[] = ["type", "workflow", "details"];
const WITHOUT_WORKFLOW_STEP: readonly ComposerStep[] = ["type", "details"];

/** The offered workflows that take an issue type, the default first. */
export const workflowsForIssueType = (
  offered: readonly TaskWorkflow[],
  issueType: IssueType | null,
): readonly TaskWorkflow[] =>
  issueType === null
    ? NO_WORKFLOWS
    : offered.filter((workflow) => workflow.issueTypes.includes(issueType));

/**
 * The steps of the New task form, the one source of the stepper and of Back and Continue. The
 * workflow step shows while several offered workflows take the picked type. Before a pick, it
 * shows while any type has several workflows.
 */
export const newTaskSteps = (
  offered: readonly TaskWorkflow[],
  issueType: IssueType | null,
): readonly ComposerStep[] => {
  const types =
    issueType === null ? issueTypeChoicesOf(offered).map(({ value }) => value) : [issueType];
  return types.some((type) => workflowsForIssueType(offered, type).length > 1)
    ? WITH_WORKFLOW_STEP
    : WITHOUT_WORKFLOW_STEP;
};

/** The steps that Back and Continue open, or null where the button does not show. */
export type AdjacentSteps = {
  readonly before: ComposerStep | null;
  readonly after: ComposerStep | null;
};

/** The steps before and after `step` in `steps`. Continue leaves the type step only after a pick. */
export const adjacentSteps = (
  steps: readonly ComposerStep[],
  step: ComposerStep,
  typePicked: boolean,
): AdjacentSteps => {
  const index = steps.indexOf(step);
  const after = steps[index + 1] ?? null;
  return {
    before: index > 0 ? steps[index - 1]! : null,
    after: step === "type" && !typePicked ? null : after,
  };
};

/**
 * The workflow of the task form. A new task can offer the enabled workflows of the repository:
 * the type comes first, then a workflow that takes it. An edited task keeps its own workflow.
 */
export const useTaskEditorWorkflow = ({
  task,
  workspaceId,
  workspaceRepoPath,
  open,
  offerWorkflowChoice = false,
  selectedWorkflowId,
  dispatch,
}: {
  task: TaskCard | null;
  workspaceId: string | null;
  workspaceRepoPath: string | null;
  open: boolean;
  offerWorkflowChoice: boolean | undefined;
  selectedWorkflowId: string | null;
  dispatch: Dispatch<TaskCreateModalAction>;
}) => {
  const workflowRead = useTaskFormWorkflow(
    task,
    workspaceId && workspaceRepoPath ? { workspaceId, repoPath: workspaceRepoPath } : null,
    open,
    offerWorkflowChoice ? selectedWorkflowId : null,
  );
  const taskWorkflow = workflowRead.taskWorkflow;
  const documentCodes = useMemo(
    () =>
      taskWorkflow?.definition.artifacts
        .filter(({ kind }) => kind === "document")
        .map(({ id }) => id) ?? [],
    [taskWorkflow],
  );
  const { workflowChoices } = workflowRead;
  const offeredChoices = useMemo(
    () => (offerWorkflowChoice && workflowChoices.length > 1 ? workflowChoices : NO_WORKFLOWS),
    [offerWorkflowChoice, workflowChoices],
  );
  const currentWorkflowId = taskWorkflow?.reference.id;
  // A type that one workflow takes picks it and goes on. With more, the current workflow stays
  // when it takes the type, else the first one that does, and the user picks.
  const selectIssueType = useCallback(
    (issueType: IssueType): void => {
      const takers = offeredChoices.filter((workflow) => workflow.issueTypes.includes(issueType));
      const kept =
        takers.find((workflow) => workflow.reference.id === currentWorkflowId) ?? takers[0];
      dispatch({
        type: "issueTypeSelected",
        issueType,
        workflowId: kept?.reference.id ?? null,
        next: takers.length > 1 ? "workflow" : "details",
      });
    },
    [dispatch, offeredChoices, currentWorkflowId],
  );
  const selectWorkflow = useCallback(
    (workflowId: string): void => dispatch({ type: "workflowSelected", workflowId }),
    [dispatch],
  );
  return {
    workflowRead,
    taskWorkflow,
    documentCodes,
    selectWorkflow,
    selectIssueType,
    /** The workflows that the form offers, the default first. Empty without a choice. */
    offeredChoices,
    /** The workflow that a new task names. Without a choice, the host uses the default. */
    createWith: offerWorkflowChoice ? taskWorkflow?.reference.id : undefined,
  };
};
