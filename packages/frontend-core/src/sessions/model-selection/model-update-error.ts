import { isOutcomeUnknown, RESULT_UNKNOWN_TITLE } from "../../lib/command-outcome";
import { errorMessage } from "../../lib/errors";
import type { ClientFeedback } from "../../platform/client-feedback";

/** A lost result keeps the host guidance; the session state shows which model the host kept. */
export const reportModelUpdateError = (feedback: ClientFeedback, cause: unknown): void => {
  feedback.show(
    "error",
    isOutcomeUnknown(cause) ? RESULT_UNKNOWN_TITLE : "Failed to update model",
    {
      description: errorMessage(cause),
    },
  );
};
