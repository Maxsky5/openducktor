// Tool rows sit on the transcript. Their hover and their selection are shades of the text color,
// so they show on the transcript in both themes and stay calm next to the colors of each status.
// The selection also gets a fine edge, so it stays clear of the hover of a row near it.

/** The hover of a tool row. */
export const TOOL_ROW_HOVER = "hover:bg-foreground/[0.035] dark:hover:bg-foreground/[0.05]";

/** The tool row of the call that the details show. */
export const TOOL_ROW_SELECTED =
  "bg-foreground/[0.07] ring-1 ring-foreground/[0.09] ring-inset dark:bg-foreground/[0.1] dark:ring-foreground/[0.12]";
