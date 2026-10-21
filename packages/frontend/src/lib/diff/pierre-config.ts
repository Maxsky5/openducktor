/**
 * App-level line limit passed to Pierre's `tokenizeMaxLength` option. Larger files and
 * diffs render as terminal plain text instead of entering the highlighting loading state.
 */
export const PIERRE_HIGHLIGHT_LINE_LIMIT = 1000;

export const PIERRE_DIFF_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;
