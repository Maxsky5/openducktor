/**
 * What a swipe down or Back does on the Request Changes sheet:
 * - `leave`: the sheet closes. Nothing is typed, or the Builder starts and the flow leaves itself.
 * - `back_to_feedback`: the start step closes, and the typed feedback stays, as Cancel does there.
 * - `confirm_discard`: the sheet asks before it drops the typed feedback.
 */
export type RequestChangesRemove = "leave" | "back_to_feedback" | "confirm_discard";

export const requestChangesRemove = (
  feedback: { message: string } | null,
  start: { open: boolean; isStarting: boolean; phase: { kind: "choices" | "progress" } } | null,
  transferredToBackground = false,
): RequestChangesRemove => {
  if (transferredToBackground) return "leave";
  if (feedback === null || feedback.message.trim().length === 0) return "leave";
  if (start?.isStarting || start?.phase.kind === "progress") return "leave";
  return start?.open ? "back_to_feedback" : "confirm_discard";
};
