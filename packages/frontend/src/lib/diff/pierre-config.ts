/**
 * Pierre 1.2.12 renders larger files and diffs as terminal plain text instead of
 * scheduling syntax highlighting. Keep the visible loading gate aligned with that policy.
 */
export const PIERRE_HIGHLIGHT_LINE_LIMIT = 1000;
