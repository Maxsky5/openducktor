import type { IncompleteWorkspaceRemoval, WorkspaceRecord } from "@openducktor/contracts";
import { type ReactElement, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";

const removalPhaseLabel = {
  attachments: "task attachments",
  task_store: "the task store",
  worktrees: "task worktrees",
} satisfies Record<IncompleteWorkspaceRemoval["record"]["phase"], string>;

type LifecycleSubmit = {
  submitting: boolean;
  error: string | null;
  confirm: () => Promise<void>;
};

const useLifecycleSubmit = (run: () => Promise<void>, onSuccess: () => void): LifecycleSubmit => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await run();
      onSuccess();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return { submitting, error, confirm };
};

type LifecycleDialogProps = {
  title: string;
  workspace: WorkspaceRecord;
  actionLabel: string;
  pendingActionLabel: string;
  destructive?: boolean;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
};

function LifecycleDialog({
  title,
  workspace,
  actionLabel,
  pendingActionLabel,
  destructive = false,
  submitting,
  error,
  onCancel,
  onConfirm,
  children,
}: LifecycleDialogProps): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!submitting && !nextOpen) onCancel();
      }}
    >
      <DialogContent
        {...(submitting ? { closeButton: null } : {})}
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {workspace.workspaceName}
            <span className="block truncate font-mono text-xs">{workspace.repoPath}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
          {children}
        </DialogBody>
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={submitting}
            onClick={onConfirm}
          >
            {submitting ? pendingActionLabel : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type WorkspaceLifecycleDialogProps = {
  workspace: WorkspaceRecord;
  onOpenChange: (open: boolean) => void;
};

export function WorkspaceCloseDialog({
  workspace,
  onOpenChange,
}: WorkspaceLifecycleDialogProps): ReactElement {
  const { closeWorkspace } = useWorkspaceState();
  const submit = useLifecycleSubmit(
    () =>
      closeWorkspace({
        workspaceId: workspace.workspaceId,
        expectedRepoPath: workspace.repoPath,
      }),
    () => onOpenChange(false),
  );

  return (
    <LifecycleDialog
      title="Close workspace"
      workspace={workspace}
      actionLabel="Close workspace"
      pendingActionLabel="Closing..."
      submitting={submit.submitting}
      error={submit.error}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => void submit.confirm()}
    >
      <p>
        The workspace disappears from the workspace rail. Nothing is deleted: its settings, tasks,
        sessions, attachments, repository files, branches, and task worktrees remain on disk.
      </p>
      <p>Reopen it later from Open a Repository.</p>
    </LifecycleDialog>
  );
}

export function WorkspaceRemoveDialog({
  workspace,
  onOpenChange,
}: WorkspaceLifecycleDialogProps): ReactElement {
  const { removeWorkspace } = useWorkspaceState();
  const [removeTaskWorktrees, setRemoveTaskWorktrees] = useState(false);
  const submit = useLifecycleSubmit(
    () =>
      removeWorkspace({
        workspaceId: workspace.workspaceId,
        expectedRepoPath: workspace.repoPath,
        removeTaskWorktrees,
      }),
    () => onOpenChange(false),
  );

  return (
    <LifecycleDialog
      title="Remove workspace"
      workspace={workspace}
      actionLabel="Remove workspace"
      pendingActionLabel="Removing..."
      destructive
      submitting={submit.submitting}
      error={submit.error}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => void submit.confirm()}
    >
      <p>
        This permanently deletes the workspace from your settings and deletes its task store: all
        tasks and subtasks in every status, workflow documents and document history, saved task
        sessions, and OpenDucktor-managed task attachments.
      </p>
      <p>OpenDucktor cannot undo this loss. The repository directory and its Git history remain.</p>
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <Checkbox
            id="remove-task-worktrees"
            checked={removeTaskWorktrees}
            disabled={submit.submitting}
            onCheckedChange={(checked) => setRemoveTaskWorktrees(checked === true)}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="remove-task-worktrees" className="cursor-pointer">
              Remove task worktrees
            </Label>
            <p className="text-xs text-muted-foreground">
              {removeTaskWorktrees
                ? "All files in the selected task worktrees, including uncommitted and untracked files, will be permanently lost. Local branches and committed history remain."
                : "Leave unchecked to keep the task worktrees and their files on disk."}
            </p>
          </div>
        </div>
      </div>
    </LifecycleDialog>
  );
}

export function WorkspaceRemovalRecoveryDialog({
  removal,
  onOpenChange,
}: {
  removal: IncompleteWorkspaceRemoval;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const { removeWorkspace } = useWorkspaceState();
  const submit = useLifecycleSubmit(
    () =>
      removeWorkspace({
        workspaceId: removal.workspace.workspaceId,
        expectedRepoPath: removal.workspace.repoPath,
        removeTaskWorktrees: removal.record.removeTaskWorktrees,
      }),
    () => onOpenChange(false),
  );

  return (
    <LifecycleDialog
      title="Workspace removal did not finish"
      workspace={removal.workspace}
      actionLabel="Retry removal"
      pendingActionLabel="Removing..."
      destructive
      submitting={submit.submitting}
      error={submit.error}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => void submit.confirm()}
    >
      <p>
        OpenDucktor stopped during removal. The workspace stays frozen until removal finishes. Data
        already deleted cannot be restored.
      </p>
      <p>
        Stopped at: {removalPhaseLabel[removal.record.phase]}. Removed task worktrees:{" "}
        {removal.record.removedWorktrees.length}.
        {removal.record.removeTaskWorktrees
          ? " Task worktrees are part of this removal."
          : " Task worktrees are kept."}
      </p>
      {removal.record.lastFailure ? (
        <p className="text-destructive" role="alert">
          {removal.record.lastFailure}
        </p>
      ) : null}
    </LifecycleDialog>
  );
}
