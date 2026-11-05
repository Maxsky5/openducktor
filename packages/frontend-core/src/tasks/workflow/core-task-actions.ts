import {
  TASK_CLOSED_STATE,
  type WorkflowActionEmphasis,
  type WorkflowIcon,
} from "@openducktor/contracts";
import type { ResolvedTaskCard } from "@openducktor/workflows";

/**
 * A task action that OpenDucktor gives every task of every workflow. A workflow does not declare
 * it. Each client shows it next to the workflow actions and opens its confirmation.
 */
export type CoreTaskAction = {
  readonly id: "reset_task" | "close_task";
  readonly label: string;
  readonly icon: WorkflowIcon;
  readonly emphasis: Extract<WorkflowActionEmphasis, "destructive" | "warning">;
  /** The confirmation that the action opens. The host command runs after the confirmation. */
  readonly confirmation: "reset_task" | "close";
};

/** Moves the task to `open` and discards its work. */
export const RESET_TASK_ACTION: CoreTaskAction = {
  id: "reset_task",
  label: "Reset Task",
  icon: "reset",
  emphasis: "destructive",
  confirmation: "reset_task",
};

/** Moves the task to `closed`. */
export const CLOSE_TASK_ACTION: CoreTaskAction = {
  id: "close_task",
  label: "Close Task",
  icon: "complete",
  emphasis: "warning",
  confirmation: "close",
};

const CORE_TASK_ACTIONS: readonly CoreTaskAction[] = [RESET_TASK_ACTION, CLOSE_TASK_ACTION];

/** Whether Close Task and Reset Task are available: the task is not closed. */
export const canRunCoreTaskActions = (task: Pick<ResolvedTaskCard, "status">): boolean =>
  task.status !== TASK_CLOSED_STATE;

/** The core actions of the task in menu order: none for a closed task. */
export const coreTaskActions = (
  task: Pick<ResolvedTaskCard, "status">,
): readonly CoreTaskAction[] => (canRunCoreTaskActions(task) ? CORE_TASK_ACTIONS : []);
