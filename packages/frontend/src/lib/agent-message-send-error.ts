import { errorMessage } from "./errors";

export class AgentMessageSendError extends Error {
  constructor(
    cause: unknown,
    readonly errorAttentionId: string,
  ) {
    super(errorMessage(cause), { cause });
    this.name = "AgentMessageSendError";
  }
}
