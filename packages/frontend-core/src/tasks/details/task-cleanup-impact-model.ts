import type { TerminalListResponse } from "@openducktor/contracts";
import type { TaskStopImpactState } from "../../queries/use-task-stop-impact";
import type { TaskWorktreeOwnersRead } from "../../queries/use-task-worktree-owners";
import type { TaskConfirmDialogState, TaskConfirmImpact } from "./task-confirm-dialog-types";
import type { TaskCleanupImpact } from "./use-task-cleanup-impact";
import { isConfirmBlockedByImpact } from "./task-worktree-owner-copy";

/** The task terminals that a cleanup stops. */
export const runningTerminalCount = (response: TerminalListResponse | undefined): number =>
  response?.terminals.filter((terminal) => terminal.lifecycle !== "exited").length ?? 0;

export const formatActiveSessionStopMessage = (activeSessionCount: number): string =>
  `${activeSessionCount} active agent session${activeSessionCount === 1 ? "" : "s"} will be stopped before closing.`;

/**
 * What a Close, Delete, or Reset Task confirmation shows. The host counts only the task worktrees
 * that still exist, so a worktree that Approve removed does not count. A host that omits the
 * count leaves the count of the session working directories.
 */
export const buildTaskConfirmImpact = (
  cleanup: TaskCleanupImpact,
  stop: TaskStopImpactState,
  owners: TaskWorktreeOwnersRead,
): TaskConfirmImpact => {
  const removedWorktreeCount = stop.removedWorktreeCount;
  return {
    // The worktree count comes with the stop impact, so the cleanup line waits for it too.
    isLoading: cleanup.isLoadingImpact || stop.isLoading || owners.isLoading,
    isLoadingStopImpact: stop.isLoading,
    hasManagedSessionCleanup:
      removedWorktreeCount === null ? cleanup.hasManagedSessionCleanup : removedWorktreeCount > 0,
    managedWorktreeCount: removedWorktreeCount ?? cleanup.managedWorktreeCount,
    terminalCount: cleanup.terminalCount,
    activeSessionCount: stop.stoppableSessionCount,
    activeSessionCountError: stop.error,
    worktreeOwners: owners,
    error: cleanup.impactError,
  };
};

type ConfirmButtonState = { isBusy: boolean; disabled: boolean; label: string };

/** The Confirm button of a confirmation waits for the action and for its impact reads. */
export const confirmButtonState = (
  impact: TaskConfirmImpact,
  operation: TaskConfirmDialogState["operation"],
  labels: { idle: string; pending: string; checking: string },
): ConfirmButtonState => {
  const isBusy = operation.isPending || impact.isLoading || impact.isLoadingStopImpact;
  let label = labels.idle;
  if (operation.isPending) label = labels.pending;
  else if (isBusy) label = labels.checking;
  return { isBusy, disabled: isBusy || isConfirmBlockedByImpact(impact), label };
};
