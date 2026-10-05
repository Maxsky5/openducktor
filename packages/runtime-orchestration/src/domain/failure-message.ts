import { Cause } from "effect";

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Describes a cause for users: the message of each failure and defect, without tags or stacks. */
export const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const messages = [...Cause.failures(cause), ...Cause.defects(cause)].map(errorMessage);
  return messages.length > 0 ? messages.join("\n") : "The operation was interrupted.";
};
