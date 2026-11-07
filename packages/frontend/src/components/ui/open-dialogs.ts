/** Every open `Dialog` and `Sheet` root, so a global shortcut can leave an open dialog alone. */
const openDialogRoots = new Set<symbol>();

export const hasOpenDialog = (): boolean => openDialogRoots.size > 0;

/** Counts a dialog root as open until the returned cleanup runs. */
export const trackOpenDialog = (root: symbol): (() => void) => {
  openDialogRoots.add(root);
  return () => {
    openDialogRoots.delete(root);
  };
};

const isFocusInOpenDialog = (): boolean =>
  Boolean(document.activeElement?.closest('[role="dialog"][data-state="open"]'));

/**
 * A close focus handler that returns the focus to a target. When a dialog that opened from this
 * one holds the focus, it moves no focus. Do not use it in a nested dialog: its parent dialog is
 * open too, and the closing dialog must return the focus into it.
 */
export const returnFocusOnClose =
  (getTarget: () => HTMLElement | null) =>
  (event: Event): void => {
    // Radix returns the focus only to a dialog trigger.
    event.preventDefault();
    if (!isFocusInOpenDialog()) getTarget()?.focus();
  };
