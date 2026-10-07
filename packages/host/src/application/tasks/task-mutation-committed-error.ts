import { HostOperationError } from "../../effect/host-errors";

/** Do not repeat a saved task change when its event fails. */
export class TaskMutationCommittedError extends HostOperationError {}
