/**
 * True while the board shows its foreground loading state: a task refresh that the user started,
 * the first settings read of a workspace, or the first task read of a board with the Kanban
 * settings. A background read of a board that has data does not count.
 */
export const isKanbanForegroundLoading = (args: {
  hasActiveWorkspace: boolean;
  isForegroundLoadingTasks: boolean;
  isSettingsPending: boolean;
  doneVisibleDays: number | undefined;
  isKanbanPending: boolean;
}): boolean => {
  if (args.isForegroundLoadingTasks || !args.hasActiveWorkspace || args.isSettingsPending) {
    return args.isForegroundLoadingTasks || (args.hasActiveWorkspace && args.isSettingsPending);
  }

  return args.doneVisibleDays !== undefined && args.isKanbanPending;
};
