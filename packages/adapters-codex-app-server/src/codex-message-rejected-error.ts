/** Preflight or a native RPC error rejected this input. Transport loss does not prove rejection. */
export class CodexMessageRejectedError extends Error {
  constructor(cause: Error) {
    super(cause.message, { cause });
    this.name = "CodexMessageRejectedError";
  }
}
