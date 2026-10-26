import type {
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
  WorkspaceSessionArchivePreview,
} from "@openducktor/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Archive, FolderGit2, LoaderCircle } from "lucide-react";
import { useId, useState, type ReactElement, type ReactNode } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMinimumLoading } from "@/lib/use-minimum-loading";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { workspaceSessionArchivePreviewQueryOptions } from "@openducktor/frontend-core/queries/workspace-session-archive";
import {
  ARCHIVE_CHAT_TEXT,
  canArchiveWorkspaceSession,
  effectiveWorktreeRemoval,
  isWorktreeChat,
  sharedWorktreeNotice,
  taskWorktreeNotice,
  worktreeArchiveConfirmation,
  worktreeArchiveNotice,
} from "@openducktor/frontend-core/workspace-sessions/workspace-session-archive-plan";
import { WorktreeArchivePreview } from "./worktree-archive-preview";

/** A shorter loader reads as a flash before the final content. */
const WORKTREE_CHECK_MINIMUM_MS = 500;

type Props = {
  open: boolean;
  workspaceId: string;
  record: WorkspaceSession;
  isArchiving: boolean;
  error: Error | null;
  onArchive: (
    removeWorktree: boolean,
    confirmation?: WorkspaceSessionArchiveInput["worktreeConfirmation"],
  ) => void;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
};

export function WorkspaceSessionArchiveDialog({ record, ...props }: Props): ReactElement {
  if (isWorktreeChat(record)) {
    return <WorktreeArchiveDialog record={record} {...props} />;
  }
  return (
    <ArchiveDialog
      {...props}
      record={record}
      onConfirm={() => props.onArchive(false)}
      canArchive={!props.isArchiving}
    >
      <p className="text-sm text-muted-foreground">{ARCHIVE_CHAT_TEXT.repositoryFilesStay}</p>
    </ArchiveDialog>
  );
}

function WorktreeArchiveDialog({ workspaceId, record, ...props }: Props): ReactElement {
  const [wantsWorktreeRemoval, setWantsWorktreeRemoval] = useState(true);
  const switchId = useId();
  const preview = useQuery({
    ...workspaceSessionArchivePreviewQueryOptions(workspaceId, record.id),
    enabled: props.open,
  });
  // The dialog shows one loader, then the content and buttons of the finished check together.
  const isChecking = useMinimumLoading(preview.isFetching, WORKTREE_CHECK_MINIMUM_MS);
  const removeWorktree = effectiveWorktreeRemoval(wantsWorktreeRemoval, preview, isChecking);
  const sharedNotice = sharedWorktreeNotice(preview);
  const taskNotice = taskWorktreeNotice(preview);
  const canArchive = canArchiveWorkspaceSession({
    record,
    removeWorktree,
    preview,
    isArchiving: props.isArchiving,
    checking: isChecking,
  });
  return (
    <ArchiveDialog
      {...props}
      record={record}
      canArchive={canArchive}
      removeWorktree={removeWorktree}
      onConfirm={() =>
        props.onArchive(
          removeWorktree,
          worktreeArchiveConfirmation(record, removeWorktree, preview),
        )
      }
    >
      {isChecking ? (
        <div
          role="status"
          className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {ARCHIVE_CHAT_TEXT.checkingWorktree}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor={switchId} className="flex-1 cursor-pointer leading-5">
              {ARCHIVE_CHAT_TEXT.removeWorktree}
            </Label>
            <Switch
              id={switchId}
              checked={removeWorktree}
              onCheckedChange={setWantsWorktreeRemoval}
              disabled={props.isArchiving || sharedNotice !== null || taskNotice !== null}
            />
          </div>
          {sharedNotice && <p className="text-sm text-muted-foreground">{sharedNotice}</p>}
          {taskNotice && <p className="text-sm text-muted-foreground">{taskNotice}</p>}
          <ArchiveWorktreeNotice removeWorktree={removeWorktree} preview={preview} />
          <WorktreeArchivePreview preview={preview} removeWorktree={removeWorktree} />
        </div>
      )}
    </ArchiveDialog>
  );
}

function ArchiveDialog({
  open,
  record,
  isArchiving,
  error,
  onClose,
  onCloseAutoFocus,
  onConfirm,
  canArchive,
  removeWorktree = false,
  children,
}: Omit<Props, "workspaceId" | "onArchive"> & {
  onConfirm: () => void;
  canArchive: boolean;
  removeWorktree?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isArchiving) onClose();
      }}
    >
      <DialogContent
        className="p-0 sm:max-w-lg"
        closeButton={isArchiving ? null : undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (canArchive) onConfirm();
          }}
        >
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle>{ARCHIVE_CHAT_TEXT.title}</DialogTitle>
            <DialogDescription>{ARCHIVE_CHAT_TEXT.description}</DialogDescription>
          </DialogHeader>
          <fieldset disabled={isArchiving} className="flex min-h-0 flex-1 flex-col border-0 p-0">
            <DialogBody className="flex flex-col gap-4 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
                  <AgentRuntimeIcon runtimeKind={record.runtimeKind} className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="break-words text-sm font-medium text-foreground">
                    {workspaceSessionTitle(record)}
                  </p>
                  <p className="break-all font-mono text-xs leading-5 text-muted-foreground">
                    {record.executionTarget.workingDirectory}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{ARCHIVE_CHAT_TEXT.stopsWork}</p>
              {children}
              {error && (
                <p role="alert" className="text-sm text-destructive-muted">
                  {errorMessage(error)}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="mt-0 justify-between border-t border-border px-5 py-4">
              <Button type="button" variant="outline" disabled={isArchiving} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={removeWorktree ? "destructive" : "default"}
                disabled={!canArchive}
                aria-busy={isArchiving}
              >
                {isArchiving ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Archive data-icon="inline-start" aria-hidden="true" />
                )}
                {isArchiving ? ARCHIVE_CHAT_TEXT.confirming : ARCHIVE_CHAT_TEXT.confirm}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveWorktreeNotice({
  removeWorktree,
  preview,
}: {
  removeWorktree: boolean;
  preview: UseQueryResult<WorkspaceSessionArchivePreview>;
}): ReactElement | null {
  const notice = worktreeArchiveNotice(removeWorktree, preview);
  if (notice.kind !== "delete_branch")
    return <p className="text-sm text-muted-foreground">{notice.text}</p>;
  // A failed check shows its own error and retry.
  if (notice.branchName === null) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Branch <span className="font-mono">{notice.branchName}</span> {notice.consequence}
    </p>
  );
}
