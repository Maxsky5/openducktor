import type { ActiveHostSession } from "./host-session-owner";

/**
 * Starts a new connection attempt now. The command gate of the demo stays open, so no view offers
 * a retry there.
 */
export const retryConnection = (session: ActiveHostSession): Promise<void> => {
  if (session.kind === "demo") return Promise.reject(new Error("The demo has no connection."));
  return session.remote.remote.retry();
};
