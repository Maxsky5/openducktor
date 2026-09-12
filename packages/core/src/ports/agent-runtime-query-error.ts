import type { RuntimeQueryFailure } from "@openducktor/contracts";

/** Native adapter read failures that the host can report without protocol details. */
export class AgentRuntimeQueryError extends Error {
  constructor(
    readonly code: RuntimeQueryFailure["code"],
    message: string,
  ) {
    super(message);
    this.name = "AgentRuntimeQueryError";
  }
}
