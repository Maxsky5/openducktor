import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import type { WorkflowIcon } from "@openducktor/contracts";
import {
  roleWorkflowForTask,
  taskWorkflowInput,
  workflowRoleIcon,
  type ResolvedTaskCard,
} from "@openducktor/workflows";
import {
  buildHumanWorkflowState,
  buildRoleWorkflowState,
  workflowStepRailState,
} from "../../lib/agent-workflow-state";
import type {
  WorkflowStepLiveSession,
  WorkflowStepPresentation,
  WorkflowStepRailState,
  WorkflowStepTone,
} from "../../types/agent-workflow";

/** One step of the workflow rail of a task. A human step has no role. */
export type WorkflowRailStep<Session> = WorkflowStepRailState & {
  id: string;
  role: string | null;
  label: string;
  /** The icon token of the role. A human step has none. */
  iconHint: WorkflowIcon | undefined;
  state: WorkflowStepPresentation;
  /** The state in one or two words, such as "Done" or "Needs input". */
  stateLabel: string;
  /** The session that a selection of the step opens. */
  session: Session | null;
  /** The launch that starts the step now, if its role can start. */
  launchActionId: string | null;
};

/** The session of a role that the rail shows, and the live state of the role. */
export type WorkflowRailRoleSession<Session> = {
  session: Session | null;
  liveSession: WorkflowStepLiveSession;
};

const STATE_LABELS = {
  done: "Done",
  in_progress: "In progress",
  available: "Ready",
  optional: "Optional",
  blocked: "Not yet",
  rejected: "Rejected",
  waiting_input: "Needs input",
  failed: "Failed",
} as const satisfies Record<WorkflowStepTone, string>;

/**
 * The workflow rail of a task, in step order, for every client and surface. Each surface gives the
 * session of each role, because Agent Studio, previews, and mobile choose that session differently.
 */
export const buildWorkflowRail = <Session>(
  task: ResolvedTaskCard,
  roleSession: (role: string) => WorkflowRailRoleSession<Session>,
): WorkflowRailStep<Session>[] =>
  task.taskWorkflow.definition.steps.map((step) => {
    const projected = task.workflowSteps.find(({ id }) => id === step.id);
    if (!projected)
      throw new Error(
        `Task "${task.id}" has no state for step "${step.id}". Refresh its workflow.`,
      );
    if (step.kind === "human") {
      const state = buildHumanWorkflowState(projected);
      return {
        id: step.id,
        role: null,
        label: step.label,
        iconHint: undefined,
        state,
        stateLabel: stateLabel(task, state),
        session: null,
        launchActionId: null,
        hint: step.label,
        attentionVariant: "none",
      };
    }
    const { session, liveSession } = roleSession(step.roleId);
    const state = buildRoleWorkflowState({
      task,
      role: step.roleId,
      workflow: roleWorkflowForTask(task, step.roleId),
      liveSession,
    });
    return {
      id: step.id,
      role: step.roleId,
      label: step.label,
      iconHint: workflowRoleIcon(task.taskWorkflow, step.roleId),
      state,
      stateLabel: stateLabel(task, state),
      session,
      launchActionId: projected.available
        ? task.taskWorkflow.evaluator.stepLaunchAction(taskWorkflowInput(task), step.id)
        : null,
      ...workflowStepRailState({ state, hasSession: session !== null }),
    };
  });

const stateLabel = (task: ResolvedTaskCard, state: WorkflowStepPresentation): string =>
  task.status === TASK_CLOSED_STATE && state.tone === "blocked"
    ? "Skipped"
    : STATE_LABELS[state.tone];
