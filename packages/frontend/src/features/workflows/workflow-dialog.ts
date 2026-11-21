/**
 * The layout of every workflow dialog. It copies Settings and Create task: a header and a footer
 * with dividers across the full width, a body that scrolls between them, and two widths.
 */
export const WORKFLOW_DIALOG = {
  /** About 450 px: confirmations and short forms. */
  sm: "max-w-md overflow-hidden p-0",
  /** About 720 px: lists, files, and long forms. */
  lg: "max-w-[720px] overflow-hidden p-0",
  /** The title keeps clear of the close button. The description uses the full width. */
  header: "border-b border-border px-6 py-4 [&>h2]:pr-10",
  /** The scrollbar gutter of the dialog takes 10 px at the right, so the right padding is less. */
  body: "min-h-0 overflow-y-auto py-4 pl-6 pr-3.5",
  footer: "mt-0 border-t border-border px-6 py-4",
} as const;
