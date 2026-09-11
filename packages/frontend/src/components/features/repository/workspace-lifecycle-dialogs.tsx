import type { WorkspaceRecord } from "@openducktor/contracts";
import { type ReactElement, useState } from "react";
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

type WorkspaceLifecycleDialogProps = {
  workspace: WorkspaceRecord;
  onOpenChange: (open: boolean) => void;
};

export function WorkspaceCloseDialog({
  workspace,
  onOpenChange,
}: WorkspaceLifecycleDialogProps): ReactElement {
  const { closeWorkspace } = useWorkspaceState();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await closeWorkspace({
        workspaceId: workspace.workspaceId,
        expectedRepoPath: workspace.repoPath,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
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
          <DialogTitle>Close workspace</DialogTitle>
          <DialogDescription>
            {workspace.workspaceName}
            <span className="block truncate font-mono text-xs">{workspace.repoPath}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            The workspace disappears from the workspace rail. Nothing is deleted: its settings,
            tasks, sessions, attachments, repository files, branches, and task worktrees remain on
            disk.
          </p>
          <p>Reopen it later from Open a Repository.</p>
        </DialogBody>
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={submitting} onClick={() => void confirm()}>
            {submitting ? "Closing..." : "Close workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceRemoveDialog({
  workspace,
  onOpenChange,
}: WorkspaceLifecycleDialogProps): ReactElement {
  const { removeWorkspace } = useWorkspaceState();
  const [removeTaskWorktrees, setRemoveTaskWorktrees] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await removeWorkspace({
        workspaceId: workspace.workspaceId,
        expectedRepoPath: workspace.repoPath,
        removeTaskWorktrees,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
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
          <DialogTitle>Remove workspace</DialogTitle>
          <DialogDescription>
            {workspace.workspaceName}
            <span className="block truncate font-mono text-xs">{workspace.repoPath}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            This permanently deletes the workspace from your settings and deletes its task store:
            all tasks and subtasks in every status, workflow documents and document history, saved
            task sessions, and OpenDucktor-managed task attachments.
          </p>
          <p>
            OpenDucktor cannot undo this loss. The repository directory and its Git history remain.
          </p>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="remove-task-worktrees"
                checked={removeTaskWorktrees}
                disabled={submitting}
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
        </DialogBody>
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => void confirm()}
          >
            {submitting ? "Removing..." : "Remove workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
