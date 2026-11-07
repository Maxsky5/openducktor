/**
 * What Cancel does on a step of a workflow sheet:
 * - `close_sheet`: the step is the last one of the sheet, so the route closes at once, as Back
 *   does. The step stays in place during the exit, and the unmount drops its state.
 * - `close_step`: the step closes through its model, which also settles work that it started,
 *   and the sheet shows what stays open or closes after that.
 */
export type SheetCancel = "close_sheet" | "close_step";

/** A start in progress closes through its model, which dismisses or keeps its startup attempt. */
export const startChoicesCancel = (phase: { kind: "choices" | "progress" }): SheetCancel =>
  phase.kind === "progress" ? "close_step" : "close_sheet";

/** An open Git conflict keeps the approval sheet open after the approval step closes. */
export const approvalCancel = (conflictOpen: boolean): SheetCancel =>
  conflictOpen ? "close_step" : "close_sheet";
