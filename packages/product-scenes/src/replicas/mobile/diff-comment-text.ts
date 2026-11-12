// The labels of the Inline Diff Comment flow: selectionLabel of diff-comment-model.ts and
// lineRangeLabel of diff-comment-view.tsx. The module loads no motion code, so a sample or a test
// can read the labels.

/** The selected new lines, as the selection bar names them. */
export function selectionLabel(start: number, end: number): string {
  return start === end ? `Line ${start}, new lines` : `Lines ${start} to ${end}, new lines`;
}

/** The lines of a pending comment on new lines, as its card names them. */
export function commentRangeLabel(start: number, end: number): string {
  return start === end ? `Line ${start}, new` : `Lines ${start}-${end}, new`;
}
