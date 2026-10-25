import { LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGES } from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import { isOutcomeUnknown } from "../../lib/command-outcome";

/** A failure of the user's own composer action, as the composer shows it. */
export type ComposerFailure = {
  /**
   * `result_unknown`: the host may have taken the action, so the app never repeats it.
   * `attachment_unavailable`: a draft attachment is no longer on the host.
   */
  kind: "result_unknown" | "attachment_unavailable" | "failed";
  title: string;
  message: string;
};

const MAX_CAUSE_DEPTH = 5;

/** Finds the error that matches in the cause chain of `error`. Senders wrap host errors. */
const findCause = <Match extends Error>(
  error: Error,
  matches: (candidate: Error) => candidate is Match,
): Match | null => {
  let current: Error | null = error;
  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (matches(current)) return current;
    current = current.cause instanceof Error ? current.cause : null;
  }
  return null;
};

const isAttachmentUnavailable = (candidate: Error): candidate is HostInvokeError =>
  candidate instanceof HostInvokeError &&
  LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGES.includes(candidate.message);

/**
 * Describes a failed send or queue action. A lost result shows "Result unknown" with the host
 * guidance. The draft stays, and the user decides whether to send again after the transcript
 * shows the current state.
 */
export const describeComposerFailure = (
  error: Error,
  {
    title,
    attachmentNames,
  }: {
    /** The title of other failures, such as "Unable to send message". */
    title: string;
    /** The attachments of the draft, so the message can name the one to attach again. */
    attachmentNames: readonly string[];
  },
): ComposerFailure => {
  const lost = findCause(error, isOutcomeUnknown);
  if (lost) {
    return {
      kind: "result_unknown",
      title: "Result unknown",
      message: `${lost.failure.message} ${lost.failure.nextAction} Check the transcript before you send it again.`,
    };
  }
  if (findCause(error, isAttachmentUnavailable)) {
    const [only] = attachmentNames;
    const subject =
      attachmentNames.length === 1 && only ? `${only} is` : "An attachment of this message is";
    return {
      kind: "attachment_unavailable",
      title: "Attach the file again",
      message: `${subject} no longer on the host. Remove it from the draft and attach the file again.`,
    };
  }
  return { kind: "failed", title, message: error.message };
};
