import { RESULT_UNKNOWN_TITLE } from "../../lib/command-outcome";
import type { SessionStartWorkflowResult } from "./session-start-workflow";

export const SESSION_START_MESSAGE_FAILED_TITLE = "Session started, but the first message failed.";
export const SESSION_START_MESSAGE_RETRY_LABEL = "Retry message";
export const SESSION_START_MESSAGE_UNKNOWN_DESCRIPTION =
  "The host may have the first message. Open the session and check the transcript before you send it again.";

/**
 * The first message of a started session that did not reach the session:
 * - `failed`: the send failed, and the user can send it again.
 * - `unknown`: the connection lost the send result. The host may have the message, so the client
 *   never sends it again.
 */
export type SessionStartMessageRetry =
  | {
      kind: "failed";
      title: string;
      /** The cause of the last failure. */
      description: string;
      actionLabel: string;
      /**
       * Sends the first message again. It returns null when the message reached the session, the
       * next retry when the send fails again, or the unknown state when the result is lost.
       */
      retry: () => Promise<SessionStartMessageRetry | null>;
    }
  | { kind: "unknown"; title: string; description: string };

/** The retry of an unsent first message, or null when the start has nothing to send again. */
export const sessionStartMessageRetry = (
  result: SessionStartWorkflowResult,
): SessionStartMessageRetry | null => {
  const retry = result.retryPostStartMessage;
  if (!retry || !result.postStartActionError) return null;
  return {
    kind: "failed",
    title: SESSION_START_MESSAGE_FAILED_TITLE,
    description: result.postStartActionError.message,
    actionLabel: SESSION_START_MESSAGE_RETRY_LABEL,
    retry: async () => {
      try {
        const receipt = await retry();
        if (receipt?.outcome !== "uncertain") return null;
        return {
          kind: "unknown",
          title: RESULT_UNKNOWN_TITLE,
          description: SESSION_START_MESSAGE_UNKNOWN_DESCRIPTION,
        };
      } catch (cause) {
        return sessionStartMessageRetry({
          ...result,
          postStartActionError: cause instanceof Error ? cause : new Error(String(cause)),
        });
      }
    },
  };
};
