/** A compact branch name with an icon. Long names truncate, and the title keeps the full name. */
export const BRANCH_CHIP_CLASS_NAME =
  "inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 font-mono text-xs text-foreground";

/** The interactive form of `BRANCH_CHIP_CLASS_NAME`. It shows a surface only on hover and focus. */
export const BRANCH_CHIP_BUTTON_CLASS_NAME =
  "cursor-pointer outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:bg-muted";
