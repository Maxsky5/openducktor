/** Every open `Dialog` and `Sheet` root, so a global shortcut can leave an open dialog alone. */
const openDialogRoots = new Map<symbol, boolean>();
const listeners = new Set<() => void>();
const focusReleasedListeners = new Set<() => void>();
export const subscribeOpenDialogs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const openDialogCount = (): number => openDialogRoots.size;
const changed = () => {
  for (const listener of listeners) listener();
};

export const hasOpenDialog = (): boolean => openDialogRoots.size > 0;
export const hasOpenModalDialog = (): boolean => {
  for (const modal of openDialogRoots.values()) {
    if (modal) return true;
  }
  return false;
};

/** Closing dialog content keeps its focus scope until it unmounts. */
export const hasMountedModalDialog = (): boolean =>
  document.querySelector(
    '[data-slot="dialog-content"][aria-modal="true"], [data-slot="dialog-positioner"]',
  ) !== null;

export const subscribeDialogFocusReleased = (listener: () => void): (() => void) => {
  focusReleasedListeners.add(listener);
  return () => {
    focusReleasedListeners.delete(listener);
  };
};

export const afterDialogCloseAutoFocus =
  (onCloseAutoFocus: ((event: Event) => void) | undefined) =>
  (event: Event): void => {
    onCloseAutoFocus?.(event);
    // Radix runs its default focus restoration and releases the focus scope after this handler.
    if (focusReleasedListeners.size > 0) {
      queueMicrotask(() => {
        for (const listener of focusReleasedListeners) listener();
      });
    }
  };

/** Counts a dialog root as open until the returned cleanup runs. */
export const trackOpenDialog = (root: symbol, modal = true): (() => void) => {
  openDialogRoots.set(root, modal);
  changed();
  return () => {
    openDialogRoots.delete(root);
    changed();
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
