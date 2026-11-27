export const HOST_UNREACHABLE_MESSAGE =
  "Host is unreachable. Try again when the connection is restored.";

/** The request did not reach the host. The host did not return this failure. */
export class HostUnreachableError extends Error {
  readonly _tag = "HostUnreachableError";
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(HOST_UNREACHABLE_MESSAGE);
    this.name = "HostUnreachableError";
    this.cause = cause;
  }
}

export const isHostUnreachableError = (cause: unknown): cause is HostUnreachableError =>
  cause instanceof HostUnreachableError;
