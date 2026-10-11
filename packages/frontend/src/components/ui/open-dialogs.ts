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
