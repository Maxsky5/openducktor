import { Cause } from "effect";

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Describes a cause for users: the message of each failure and defect, without tags or stacks. */
export const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const failures = cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error);
  const defects = cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect);
  const messages = [...failures, ...defects].map(errorMessage);
  return messages.length > 0 ? messages.join("\n") : "The operation was interrupted.";
};
