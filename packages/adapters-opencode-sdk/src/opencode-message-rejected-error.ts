/** Permission setup blocked the message before the native request. */
export class OpenCodeMessageRejectedError extends Error {
  constructor(cause: Error) {
    super(cause.message, { cause });
    this.name = "OpenCodeMessageRejectedError";
  }
}
