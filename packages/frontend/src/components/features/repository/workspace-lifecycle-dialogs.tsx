import type { IncompleteWorkspaceRemoval, WorkspaceRecord } from "@openducktor/contracts";
import { EyeOff, type LucideIcon, Loader2, RotateCcw, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state/app-state-provider";
import { WorkspaceIdentityCard } from "./workspace-identity";

const removalPhaseLabel = {
  attachments: "task attachments",
  task_store: "the task store",
  worktrees: "task worktrees",
} satisfies Record<IncompleteWorkspaceRemoval["record"]["phase"], string>;

const noticeToneClassNames = {
  info: "border-info-border bg-info-surface text-info-surface-foreground",
  warning: "border-warning-border bg-warning-surface text-warning-surface-foreground",
  destructive:
    "border-destructive-border bg-destructive-surface text-destructive-surface-foreground",
} as const;

type NoticeTone = keyof typeof noticeToneClassNames;

function LifecycleNotice({
  tone,
  className,
  children,
}: {
  tone: NoticeTone;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border px-3 py-2 text-sm",
        noticeToneClassNames[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

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
  icon: LucideIcon;
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
  description,
  icon: ActionIcon,
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

        <DialogBody className="py-4">
          {children}
          {error ? (
            <p className="mt-3 text-sm text-destructive-muted" role="alert">
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
      description="Hide this workspace from OpenDucktor? Nothing is deleted."
      icon={EyeOff}
      actionLabel="Close workspace"
      pendingActionLabel="Closing..."
      submitting={submit.submitting}
      error={submit.error}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => void submit.confirm()}
    >
      <WorkspaceIdentityCard workspace={workspace} />
      <LifecycleNotice tone="info" className="mt-3">
        <p className="font-medium">The workspace is hidden until you reopen it.</p>
        <p>
          Nothing is deleted. Settings, tasks, sessions, attachments, repository files, branches,
          and task worktrees stay on disk.
        </p>
        <p>You can reopen it from Open a Repository.</p>
      </LifecycleNotice>
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
      description="Remove this workspace and everything in it? This cannot be undone."
      icon={Trash2}
      actionLabel="Remove workspace"
      pendingActionLabel="Removing..."
      destructive
      submitting={submit.submitting}
      error={submit.error}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => void submit.confirm()}
    >
      <WorkspaceIdentityCard workspace={workspace} />
      <LifecycleNotice tone="destructive" className="mt-3">
        <p className="font-medium">This action permanently removes the workspace.</p>
        <p>The following items are deleted and cannot be recovered:</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>The workspace entry in your settings</li>
          <li>Its task store with all tasks and subtasks in every status</li>
          <li>Workflow documents and document history</li>
          <li>Saved task sessions</li>
          <li>OpenDucktor-managed task attachments</li>
        </ul>
        <p>The repository directory and its Git history remain.</p>
      </LifecycleNotice>
      <div className="mt-3 flex items-start gap-3 rounded-lg border border-border bg-card p-3">
        <Checkbox
          id="remove-task-worktrees"
          className="mt-0.5"
          checked={removeTaskWorktrees}
          disabled={submit.submitting}
          onCheckedChange={(checked) => setRemoveTaskWorktrees(checked === true)}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="remove-task-worktrees" className="cursor-pointer text-sm font-medium">
            Remove task worktrees
          </Label>
          <p className="text-xs text-muted-foreground">
            When checked, task worktrees are deleted with their local files, including uncommitted
            and untracked changes. Local branches and committed history remain.
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
  const [removeTaskWorktrees, setRemoveTaskWorktrees] = useState(
    removal.record.removeTaskWorktrees,
  );
  const canChangeWorktreeChoice =
    removal.record.phase === "worktrees" &&
    removal.record.removedWorktrees.length === 0 &&
    removal.record.pendingWorktreePath === null;
  const submit = useLifecycleSubmit(
    () =>
      removeWorkspace({
        workspaceId: removal.workspace.workspaceId,
        expectedRepoPath: removal.workspace.repoPath,
        removeTaskWorktrees: canChangeWorktreeChoice
          ? removeTaskWorktrees
          : removal.record.removeTaskWorktrees,
      }),
    () => onOpenChange(false),
  );

  return (
    <LifecycleDialog
      title="Workspace removal did not finish"
      description="Removal must finish before you can use this workspace again."
      icon={RotateCcw}
      actionLabel="Retry removal"
      pendingActionLabel="Removing..."
      destructive
      submitting={submit.submitting}
      error={submit.error}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => void submit.confirm()}
    >
      <WorkspaceIdentityCard workspace={removal.workspace} />
      <LifecycleNotice tone="warning" className="mt-3">
        <p className="font-medium">
          OpenDucktor stopped during removal. The workspace stays frozen until removal finishes.
        </p>
        <p>Data already deleted cannot be restored.</p>
        <p>
          Stopped at: {removalPhaseLabel[removal.record.phase]}. Removed task worktrees:{" "}
          {removal.record.removedWorktrees.length}.
          {removeTaskWorktrees
            ? " Task worktrees are part of this removal."
            : " Task worktrees are kept."}
        </p>
      </LifecycleNotice>
      {removal.record.lastFailure ? (
        <p className="mt-3 text-sm text-destructive-muted" role="alert">
          {removal.record.lastFailure}
        </p>
      ) : null}
      {canChangeWorktreeChoice ? (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-border bg-card p-3">
          <Checkbox
            id="recovery-remove-task-worktrees"
            className="mt-0.5"
            checked={removeTaskWorktrees}
            disabled={submit.submitting}
            onCheckedChange={(checked) => setRemoveTaskWorktrees(checked === true)}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <Label
              htmlFor="recovery-remove-task-worktrees"
              className="cursor-pointer text-sm font-medium"
            >
              Remove task worktrees
            </Label>
            <p className="text-xs text-muted-foreground">
              Uncheck to finish removal without deleting task worktrees. Local branches and
              committed history stay in both cases.
            </p>
          </div>
        </div>
      ) : null}
    </LifecycleDialog>
  );
}
