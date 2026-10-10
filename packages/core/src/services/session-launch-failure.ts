import type { SessionLaunchResult } from "@openducktor/contracts";

/** Names every failed cleanup step, so the user knows what still needs a fix. */
export const sessionLaunchFailureMessage = (
  failure: NonNullable<SessionLaunchResult["failure"]>,
): string =>
  failure.cleanupErrors.length > 0
    ? `${failure.message} Cleanup failed: ${failure.cleanupErrors.join("; ")}`
    : failure.message;
