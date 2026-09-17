import type { IncompleteWorkspaceRemoval, WorkspaceRecord } from "@openducktor/contracts";
import { EyeOff, FolderGit2, Loader2, Trash2, type LucideIcon } from "lucide-react";
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
  description: ReactNode;
  actionLabel: string;
  pendingActionLabel: string;
  actionIcon: LucideIcon;
  destructive?: boolean;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
};

function RepositoryPath({ path }: { path: string }): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-sm">
        <FolderGit2 aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">Repository</p>
        <p className="truncate font-mono text-sm text-foreground" title={path}>
          {path}
        </p>
      </div>
    </div>
  );
}

function LifecycleDialog({
  title,
  description,
  actionLabel,
  pendingActionLabel,
  actionIcon: ActionIcon,
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
        className="max-w-lg"
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
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 py-4 text-sm text-muted-foreground">
          {children}
          {error ? (
            <p className="text-destructive-muted" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter className="mt-0 flex flex-row justify-between gap-2 border-t border-border pt-5">
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={submitting}
            aria-busy={submitting}
            onClick={onConfirm}
          >
            {submitting ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <ActionIcon data-icon="inline-start" />
            )}
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
      description={`Hide ${workspace.workspaceName} from the workspace rail?`}
      actionLabel="Close workspace"
      pendingActionLabel="Closing..."
      actionIcon={EyeOff}
      submitting={submit.submitting}
      error={submit.error}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => void submit.confirm()}
    >
      <RepositoryPath path={workspace.repoPath} />
      <div className="flex gap-3 rounded-lg border border-border bg-card p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <EyeOff aria-hidden="true" className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-foreground">Only the workspace rail entry is hidden.</p>
          <p className="text-xs leading-5 text-muted-foreground">
            Tasks, sessions, repository files, branches, and task worktrees stay on disk. You can
            reopen this workspace later.
          </p>
        </div>
      </div>
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
      description={`Permanently remove ${workspace.workspaceName} and its task data? This cannot be undone.`}
      actionLabel="Remove workspace"
      pendingActionLabel="Removing..."
      actionIcon={Trash2}
      destructive
      submitting={submit.submitting}
      error={submit.error}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => void submit.confirm()}
    >
      <RepositoryPath path={workspace.repoPath} />
      <div className="flex flex-col gap-2 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-destructive-surface-foreground">
        <p className="font-medium">
          OpenDucktor will delete the workspace settings, all tasks, workflow documents, saved
          sessions, and managed attachments.
        </p>
        <p>The repository directory, Git branches, and committed history stay on disk.</p>
      </div>
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
        <Checkbox
          id="remove-task-worktrees"
          className="mt-0.5"
          checked={removeTaskWorktrees}
          disabled={submit.submitting}
          onCheckedChange={(checked) => setRemoveTaskWorktrees(checked === true)}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="remove-task-worktrees" className="cursor-pointer leading-5">
            Remove task worktrees
          </Label>
          <p className="text-xs leading-5 text-muted-foreground">
            Also delete task worktrees, including uncommitted and untracked files. Local branches
            and committed history stay on disk.
          </p>
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
  const canKeepTaskWorktrees =
    removal.record.removeTaskWorktrees &&
    removal.record.phase === "worktrees" &&
    removal.record.pendingWorktreePath === null;
  const [removeTaskWorktrees, setRemoveTaskWorktrees] = useState(
    removal.record.removeTaskWorktrees,
  );
  const submit = useLifecycleSubmit(
    () =>
      removeWorkspace({
        workspaceId: removal.workspace.workspaceId,
        expectedRepoPath: removal.workspace.repoPath,
        removeTaskWorktrees,
      }),
    () => onOpenChange(false),
  );

  return (
    <LifecycleDialog
      title="Workspace removal did not finish"
      description={`Finish removing ${removal.workspace.workspaceName} from OpenDucktor.`}
      actionLabel="Retry removal"
      pendingActionLabel="Removing..."
      actionIcon={Trash2}
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
        Stopped at: {removalPhaseLabel[removal.record.phase]}.
        {removeTaskWorktrees
          ? " Task worktrees are part of this removal."
          : " Task worktrees are kept."}
      </p>
      {canKeepTaskWorktrees ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-3">
          <Checkbox
            id="retry-remove-task-worktrees"
            className="mt-0.5"
            checked={removeTaskWorktrees}
            disabled={submit.submitting}
            onCheckedChange={(checked) => setRemoveTaskWorktrees(checked === true)}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="retry-remove-task-worktrees" className="cursor-pointer">
              Remove task worktrees
            </Label>
            <p className="text-xs text-muted-foreground">
              Clear this option to keep task worktrees and continue removal.
            </p>
          </div>
        </div>
      ) : null}
    </LifecycleDialog>
  );
}
