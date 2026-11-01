import { RemoteConnectionError, RemoteReplyTooLargeError } from "@openducktor/host-client/remote";

/** The title of an item whose command result the connection lost. */
export const RESULT_UNKNOWN_TITLE = "Result unknown";

/**
 * True when the connection lost the result of a command. The host may have run it, so the client
 * reads the current host state and never sends the command again on its own.
 */
export const isOutcomeUnknown = (cause: unknown): cause is RemoteConnectionError =>
  cause instanceof RemoteConnectionError && cause.failure.code === "outcome_unknown";

/**
 * True when the host connection failed, not the work itself. The connection state shows the
 * failure, and the reconnect reads the active views again, so a view does not report it twice. A
 * reply that is too large fails only its own read, so its view reports it.
 */
export const isConnectionFailure = (cause: unknown): cause is RemoteConnectionError =>
  cause instanceof RemoteConnectionError && !(cause instanceof RemoteReplyTooLargeError);
