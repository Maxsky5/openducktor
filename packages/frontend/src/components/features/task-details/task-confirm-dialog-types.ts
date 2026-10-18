import type { TaskStopImpactOperation } from "@openducktor/contracts";

/** A task action that asks for confirmation. Reset Implementation has its own modal. */
export type TaskConfirmAction = Exclude<TaskStopImpactOperation, "reset_implementation">;

/**
 * A confirmation that opens on any page. Close Task asks for confirmation only in the details
 * sheet.
 */
export type TaskConfirmRequestAction = Exclude<TaskConfirmAction, "close">;

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

/** The state and handlers that each task confirmation dialog takes. */
export type TaskConfirmDialogState = {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  impact: TaskConfirmImpact;
  operation: { isPending: boolean; error: string | null };
};

/** The props that each task confirmation dialog shares. */
export type TaskConfirmDialogProps = TaskConfirmDialogState & {
  taskId: string;
  /** Runs after the dialog closed and its exit animation ended. */
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
};
