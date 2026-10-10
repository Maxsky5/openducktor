import { OpenCodeOperationError } from "./opencode-client";

/** Preparation blocked input before native submission. */
export class OpenCodeMessageRejectedError extends Error {
  readonly failure?: OpenCodeOperationError["failure"];

  constructor(cause: Error) {
    super(cause.message, { cause });
    this.name = "OpenCodeMessageRejectedError";
    if (cause instanceof OpenCodeOperationError) this.failure = cause.failure;
  }
}
