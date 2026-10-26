/** What the composer does for one hardware keyboard Enter press. */
export type HardwareEnterAction =
  /** Shift+Enter: the native view has already inserted the line break. */
  | "line_break"
  /** Enter while the suggestion list shows rows picks its first suggestion. */
  | "pick_suggestion"
  | "send"
  /**
   * Enter while send is closed, or while the suggestion list loads or has no row, does nothing,
   * so the draft stays as it is.
   */
  | "none";

/**
 * Decides one hardware Enter press. Plain Enter sends and Shift+Enter adds a line. While the
 * suggestion list shows, Enter never sends, as on desktop: the typed query is not a message. The
 * software keyboard Return key sends no event, so it always adds a line.
 */
export const resolveHardwareEnter = ({
  shift,
  suggestionRows,
  sendAllowed,
}: {
  shift: boolean;
  /** The rows of the suggestion list, or null while no list shows. */
  suggestionRows: number | null;
  sendAllowed: boolean;
}): HardwareEnterAction => {
  if (shift) return "line_break";
  if (suggestionRows !== null) return suggestionRows > 0 ? "pick_suggestion" : "none";
  return sendAllowed ? "send" : "none";
};
