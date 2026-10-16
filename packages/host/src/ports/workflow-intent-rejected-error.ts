import { HostOperationError, errorMessage } from "../effect/host-errors";
export class WorkflowIntentRejectedError extends HostOperationError {
  constructor(cause: unknown) {
    super({ operation: "workflow.intent", message: errorMessage(cause), cause });
  }
}
