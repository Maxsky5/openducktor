import type { TaskStopImpactOperation } from "@openducktor/contracts";

/**
 * A task action whose confirmation shows the cleanup impact. Reset Implementation has its own
 * modal, and Close Task has its own confirmation with the cleanup choice.
 */
export type TaskConfirmAction = Exclude<TaskStopImpactOperation, "reset_implementation" | "close">;

/** A confirmation that opens on any page. */
export type TaskConfirmRequestAction = TaskConfirmAction | "close";
