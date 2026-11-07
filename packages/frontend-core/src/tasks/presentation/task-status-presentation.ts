import type { SharedBoardState, WorkflowTone } from "@openducktor/contracts";
/**
 * The color family of a task status. `review` and `approval` have no semantic theme token, so
 * each client picks its own color for them. A label always goes with the color.
 */
export type TaskStatusTone = WorkflowTone;

export const statusLabel = (state: SharedBoardState): string => state.label;
export const statusTone = (state: SharedBoardState): TaskStatusTone => state.tone;
