import type { AcceptedAgentUserMessage } from "@openducktor/core";

export class CodexMessageAcceptedError extends Error {
  constructor(
    readonly acceptedMessage: AcceptedAgentUserMessage,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "CodexMessageAcceptedError";
  }
}
