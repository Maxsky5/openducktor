/**
 * How the content of a row that opens and folds shows: in the row, measuring itself before it
 * opens, over the row while the rows under it cover it as the row folds, or not at all.
 */
export type FoldMode = "open" | "measuring" | "folding" | "folded";

/** What a change of `open` does to the content of a row that opens and folds with the motion. */
export type FoldStep =
  /** The content measures itself out of the layout, then the row opens. */
  | { kind: "measure" }
  /** The content still folds, so the row opens again at once with its known height. */
  | { kind: "reopen"; height: number }
  /** The row folds with the motion. */
  | { kind: "fold"; height: number }
  /** The content never showed whole, so it goes at once. */
  | { kind: "hide" };

export const readFoldStep = (mode: FoldMode, open: boolean, contentHeight: number): FoldStep => {
  if (open) {
    // Folding content keeps its views and its place, so it lays out no more, and a measure would
    // wait for a layout that does not come.
    return mode === "folding" && contentHeight > 0
      ? { kind: "reopen", height: contentHeight }
      : { kind: "measure" };
  }
  return mode === "open" && contentHeight > 0
    ? { kind: "fold", height: contentHeight }
    : { kind: "hide" };
};
