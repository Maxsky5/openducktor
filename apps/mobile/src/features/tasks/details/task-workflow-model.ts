import type { WorkflowIcon } from "@openducktor/contracts";
import {
  buildHumanWorkflowState,
  buildRoleWorkflowState,
} from "@openducktor/frontend-core/lib/agent-workflow-state";
import {
  roleWorkflowForTask,
  taskWorkflowInput,
  type ResolvedTaskCard as TaskCard,
  type WorkflowRoleId as AgentRole,
  workflowRoleIcon,
} from "@openducktor/workflows";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type {
  WorkflowStepPresentation,
  WorkflowStepTone,
} from "@openducktor/frontend-core/types/agent-workflow";
import type { TaskSessionGroup } from "./task-sessions-model";

/** One Workflow Role of a task, as the desktop workflow rail shows it. */
export type TaskWorkflowStep = {
  id: string;
  role: AgentRole | null;
  iconHint?: WorkflowIcon | undefined;
  launchActionId: string | null;
  label: string;
  state: WorkflowStepPresentation;
  /** The state in one or two words, such as "Done" or "Needs input". */
  stateLabel: string;
  /** True while a session of the role works. */
  working: boolean;
  /** The newest session of the role, which a tap on the step opens. */
  session: AgentSessionIdentity | null;
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
 * The four Workflow Roles of a task in workflow order, each with its state from the task workflow
 * and the live state of its newest session. It uses the same rules as the desktop workflow rail.
 */
export const taskWorkflowSteps = (
  task: TaskCard,
  groups: readonly TaskSessionGroup[],
): TaskWorkflowStep[] =>
  task.taskWorkflow.definition.steps.map((step) => {
    const role = step.kind === "agent" ? step.roleId : null;
    const newest = role ? (groups.find((group) => group.role === role)?.rows[0] ?? null) : null;
    const projected = task.workflowSteps.find(({ id }) => id === step.id)!;
    const state = role
      ? buildRoleWorkflowState({
          task,
          role,
          workflow: roleWorkflowForTask(task, role),
          liveSession: newest?.activityState ?? "none",
        })
      : buildHumanWorkflowState(projected);
    return {
      id: step.id,
      role,
      iconHint: role ? workflowRoleIcon(task.taskWorkflow, role) : undefined,
      launchActionId:
        step.kind === "agent" && projected.available
          ? task.taskWorkflow.evaluator.stepLaunchAction(taskWorkflowInput(task), step.id)
          : null,
      label: step.label,
      state,
      stateLabel:
        task.sharedState.terminal && state.tone === "blocked"
          ? "Skipped"
          : STATE_LABELS[state.tone],
      working: newest?.live ?? false,
      session: newest?.identity ?? null,
    };
  });
