/** What a task confirmation shows about the cleanup that its action runs. */
export type TaskConfirmImpact = {
  isLoading: boolean;
  isLoadingStopImpact: boolean;
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  terminalCount: number;
  activeSessionCount: number | null;
  activeSessionCountError: string | null;
  error: string | null;
};

/** The confirmed action: whether it runs, and the reason of its last failure. */
export type TaskConfirmOperation = {
  isPending: boolean;
  error: string | null;
  /** True when the connection lost the result of the last run. The host may have run it. */
  errorOutcomeUnknown: boolean;
};

/** The state and handlers that each task confirmation dialog takes. */
export type TaskConfirmDialogState = {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  impact: TaskConfirmImpact;
  operation: TaskConfirmOperation;
};
