import { CircleCheckBig, Loader2 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatManagedSessionCleanupLoadingMessage,
  formatManagedSessionCleanupMessage,
  formatUnknownManagedSessionCleanupMessage,
} from "./task-cleanup-impact-model";

type TaskCloseConfirmDialogProps = {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  taskId: string;
  isLoadingImpact: boolean;
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  terminalCount: number;
  impactError: string | null;
  isClosePending: boolean;
  closeError: string | null;
};

export function TaskCloseConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  taskId,
  isLoadingImpact,
  hasManagedSessionCleanup,
  managedWorktreeCount,
  terminalCount,
  impactError,
  isClosePending,
  closeError,
}: TaskCloseConfirmDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Close Task</DialogTitle>
          <DialogDescription>Close {taskId} manually and move it to Done?</DialogDescription>
        </DialogHeader>

        <DialogBody className="py-4">
          <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-surface-foreground">
            <p className="font-medium">
              This manual override moves the task to Done and bypasses unfinished workflow steps.
            </p>
            <p>No code is merged and no pull request is created, updated, or merged.</p>
            <p>Task-scoped dev servers will be stopped.</p>
            <p>
              {terminalCount === 0
                ? "No running task terminals will be stopped."
                : `${terminalCount} associated terminal${terminalCount === 1 ? "" : "s"} will be terminated before the task closes.`}
            </p>
            {isLoadingImpact ? (
              <p>{formatManagedSessionCleanupLoadingMessage("close")}</p>
            ) : impactError ? (
              <p>{formatUnknownManagedSessionCleanupMessage()}</p>
            ) : hasManagedSessionCleanup ? (
              <p>{formatManagedSessionCleanupMessage(managedWorktreeCount)}</p>
            ) : (
              <p>
                Linked task worktrees and related local branches will be deleted when present. Any
                uncommitted changes in those worktrees will be lost.
              </p>
            )}
            <p>The task record, documents, QA reports, and linked history are retained.</p>
          </div>
          {impactError ? <p className="mt-2 text-destructive-muted">{impactError}</p> : null}
          {closeError ? <p className="mt-2 text-destructive-muted">{closeError}</p> : null}
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-between gap-2 border-t border-border pt-5">
          <Button type="button" variant="outline" disabled={isClosePending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="warning"
            disabled={isClosePending || isLoadingImpact}
            aria-busy={isClosePending || isLoadingImpact}
            onClick={onConfirm}
          >
            {isClosePending || isLoadingImpact ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <CircleCheckBig data-icon="inline-start" />
            )}
            {isClosePending ? "Closing..." : isLoadingImpact ? "Checking..." : "Close task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
