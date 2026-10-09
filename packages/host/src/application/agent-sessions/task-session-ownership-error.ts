import { HostOperationError } from "../../effect/host-errors";

/** Keep the saved session when publishing its ownership fails. */
export class TaskSessionOwnershipCommittedError extends HostOperationError {}
