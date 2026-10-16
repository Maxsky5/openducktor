import type { SessionOperationObservation } from "@openducktor/contracts";
import { HostOperationError, errorMessage } from "../effect/host-errors";

export class SessionOperationError extends HostOperationError {
  constructor(
    readonly observation: SessionOperationObservation,
    cause: unknown,
  ) {
    super({ operation: `session.${observation.kind}`, message: errorMessage(cause), cause });
  }
}
