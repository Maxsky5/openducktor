import type { TaskStopImpactOperation } from "@openducktor/contracts";

/** A task action that asks for confirmation. Reset Implementation has its own modal. */
export type TaskConfirmAction = Exclude<TaskStopImpactOperation, "reset_implementation">;

/**
 * A confirmation that opens on any page. Close Task asks for confirmation only in the details
 * sheet.
 */
export type TaskConfirmRequestAction = Exclude<TaskConfirmAction, "close">;
