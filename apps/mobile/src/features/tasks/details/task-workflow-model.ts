import { buildRoleWorkflowState } from "@openducktor/frontend-core/lib/agent-workflow-state";
import {
  roleWorkflowForTask,
  type BuiltinTaskCard as TaskCard,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";
import { BUILTIN_ROLE_LABELS } from "@openducktor/workflows";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type {
  WorkflowStepPresentation,
  WorkflowStepTone,
} from "@openducktor/frontend-core/types/agent-workflow";
import type { TaskSessionGroup } from "./task-sessions-model";

/** One Workflow Role of a task, as the desktop workflow rail shows it. */
export type TaskWorkflowStep = {
  role: AgentRole;
  label: string;
  state: WorkflowStepPresentation;
  /** The state in one or two words, such as "Done" or "Needs input". */
  stateLabel: string;
  /** True while a session of the role works. */
  working: boolean;
  /** The newest session of the role, which a tap on the step opens. */
  session: AgentSessionIdentity | null;
};

const ROLES: readonly AgentRole[] = ["spec", "planner", "build", "qa"];

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
  ROLES.map((role) => {
    const newest = groups.find((group) => group.role === role)?.rows[0] ?? null;
    const state = buildRoleWorkflowState({
      task,
      role,
      workflow: roleWorkflowForTask(task, role),
      liveSession: newest?.activityState ?? "none",
    });
    // A Done task opens no step, so a step that never finished was skipped, not still to come.
    const skipped = task.status === "closed" && state.tone === "blocked";
    return {
      role,
      label: BUILTIN_ROLE_LABELS[role],
      state,
      stateLabel: skipped ? "Skipped" : STATE_LABELS[state.tone],
      working: newest?.live ?? false,
      session: newest?.identity ?? null,
    };
  });
