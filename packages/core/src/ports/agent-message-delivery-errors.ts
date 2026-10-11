/**
 * A runtime refuses a new turn because native work still runs in the session.
 * The message queue keeps the message and delivers it after the turn ends.
 */
export class AgentSessionTurnActiveError extends Error {
  constructor(externalSessionId: string) {
    super(`Session '${externalSessionId}' is still working, so it cannot start a new turn.`);
    this.name = "AgentSessionTurnActiveError";
  }
}

/**
 * The runtime or a check before the native request refused the message, so the runtime did not
 * take it. The caller can send it again. A timeout or a lost connection does not prove a refusal.
 */
export class AgentSessionMessageRefusedError extends Error {
  constructor(cause: Error) {
    super(cause.message, { cause });
    this.name = "AgentSessionMessageRefusedError";
  }
}

/**
 * The adapter sent a message to the runtime, but no conclusive answer came back. The runtime
 * can still have accepted it. A live `user_message` with `messageId` proves that it did.
 */
export class AgentSessionMessageAcceptanceUnknownError extends Error {
  readonly messageId: string;

  constructor(input: { externalSessionId: string; messageId: string; cause: unknown }) {
    const detail = input.cause instanceof Error ? ` ${input.cause.message}` : "";
    super(
      `OpenDucktor cannot tell if session '${input.externalSessionId}' received the message.${detail}`,
      { cause: input.cause },
    );
    this.name = "AgentSessionMessageAcceptanceUnknownError";
    this.messageId = input.messageId;
  }
}
