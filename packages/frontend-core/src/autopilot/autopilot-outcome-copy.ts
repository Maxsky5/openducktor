import type { AutopilotOutcome, AutopilotState } from "@openducktor/contracts";
import { getAutopilotAction } from "@openducktor/workflows";
import {
  type AutopilotFailedOutcome,
  type AutopilotRecovery,
  createAutopilotRecovery,
} from "./autopilot-recovery";

export type AutopilotSkippedOutcome = Extract<AutopilotOutcome, { kind: "skipped" }>;

/** An outcome that the host holds until a client reads it: a failed or skipped action. */
export type AutopilotHeldOutcome = AutopilotFailedOutcome | AutopilotSkippedOutcome;

export const AUTOPILOT_RETRY_MESSAGE_LABEL = "Retry message";
export const AUTOPILOT_FAILURE_TITLE = "Autopilot cannot evaluate task changes.";

const actionLabel = (outcome: AutopilotOutcome): string =>
  getAutopilotAction(outcome.actionId).label;

export const autopilotSkippedTitle = (outcome: AutopilotSkippedOutcome): string =>
  `Autopilot skipped ${actionLabel(outcome)} for ${outcome.task.id}.`;

/** The title of a failed launch whose session started without its first message. */
export const autopilotRecoveryTitle = (outcome: AutopilotFailedOutcome): string =>
  `Autopilot started ${actionLabel(outcome)} for ${outcome.task.id}, but the first message failed.`;

/** The title of a failed launch that has no unsent first message. */
export const autopilotFailedTitle = (outcome: AutopilotFailedOutcome): string =>
  `Autopilot could not start ${actionLabel(outcome)} for ${outcome.task.id}.`;

/** The cause of a failed launch that has no unsent first message, with the next step. */
export const autopilotFailedDescription = (outcome: AutopilotFailedOutcome): string => {
  const nextStep = outcome.launch?.session
    ? "Open the session to check it, then start the action again if needed."
    : "Fix the cause, then start the action from the task.";
  return `${outcome.message} ${nextStep}`;
};

export const autopilotNotClaimedTitle = (outcome: AutopilotOutcome): string =>
  `Autopilot did not send the message for ${outcome.task.id} again.`;

export const AUTOPILOT_NOT_CLAIMED_DESCRIPTION =
  "A retry already ran for this message, or a later Autopilot action replaced it. Open the session to check it, then send a new message if needed.";

/** One held outcome of a task, as a view lists it. */
export type AutopilotHeldOutcomeRow = {
  outcome: AutopilotHeldOutcome;
  title: string;
  description: string;
  /** The failed launch has an unsent first message that Retry message can send. */
  canRetry: boolean;
};

const heldOutcomeRow = (
  outcome: AutopilotHeldOutcome,
  recovery: AutopilotRecovery | null,
): AutopilotHeldOutcomeRow => {
  if (outcome.kind === "skipped") {
    return {
      outcome,
      title: autopilotSkippedTitle(outcome),
      description: outcome.reason,
      canRetry: false,
    };
  }
  if (recovery) {
    return {
      outcome,
      title: autopilotRecoveryTitle(outcome),
      description: recovery.message,
      canRetry: true,
    };
  }
  return {
    outcome,
    title: autopilotFailedTitle(outcome),
    description: autopilotFailedDescription(outcome),
    canRetry: false,
  };
};

/** The failed and skipped outcomes that the host holds for one task, in host order. */
export const buildAutopilotHeldOutcomeRows = (
  state: AutopilotState,
  taskId: string,
): AutopilotHeldOutcomeRow[] =>
  state.outcomes.flatMap((outcome) => {
    if (outcome.task.id !== taskId || outcome.kind === "started") return [];
    const recovery = outcome.kind === "failed" ? createAutopilotRecovery(outcome) : null;
    return [heldOutcomeRow(outcome, recovery)];
  });
