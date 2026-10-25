import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  isOutcomeUnknown,
  RESULT_UNKNOWN_TITLE,
} from "@openducktor/frontend-core/lib/command-outcome";

/**
 * How a host command ended when it did not succeed. A lost result is `unknown`: the host may have
 * run it, so the view shows the host guidance and never sends the command again on its own.
 */
export type CommandFailure =
  | { kind: "unknown"; title: string; message: string }
  | { kind: "failed"; title: string; message: string };

/** The notice of a failed host command. `failureTitle` names the action that failed. */
export const toCommandFailure = (cause: unknown, failureTitle: string): CommandFailure => {
  if (isOutcomeUnknown(cause)) {
    // The error message joins the host failure message and its next action.
    return { kind: "unknown", title: RESULT_UNKNOWN_TITLE, message: cause.message };
  }
  return { kind: "failed", title: failureTitle, message: errorMessage(cause) };
};

/** The notice of an error that a frontend-core flow kept as text, with its outcome flag. */
export const toFlowFailure = (
  message: string,
  outcomeUnknown: boolean,
  failureTitle: string,
): CommandFailure =>
  outcomeUnknown
    ? { kind: "unknown", title: RESULT_UNKNOWN_TITLE, message }
    : { kind: "failed", title: failureTitle, message };
