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
import { errorMessage } from "@/lib/errors";
import { workspaceSessionTitle } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { workspaceSessionArchivePreviewQueryOptions } from "@/state/queries/workspace-session-archive";
import { WorktreeArchivePreview } from "./worktree-archive-preview";

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
  if (record.executionTarget.kind === "local_worktree") {
    return <WorktreeArchiveDialog record={record} {...props} />;
  }
  return (
    <ArchiveDialog
      {...props}
      record={record}
      onConfirm={() => props.onArchive(false)}
      canArchive={!props.isArchiving}
    >
      <p className="text-sm text-muted-foreground">Your repository files will stay on disk.</p>
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
            <DialogTitle>Archive chat</DialogTitle>
            <DialogDescription>
              Move this chat to Archived chats. You can restore it later.
            </DialogDescription>
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
              <p className="text-sm text-muted-foreground">
                Archiving stops this chat's terminals, development servers, and its running session.
                Your chat history stays available in Archived chats.
              </p>
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
                {isArchiving ? "Archiving…" : "Archive chat"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorktreeArchiveDialog({ workspaceId, record, ...props }: Props): ReactElement {
  const [removeWorktree, setRemoveWorktree] = useState(true);
  const switchId = useId();
  const preview = useQuery({
    ...workspaceSessionArchivePreviewQueryOptions(workspaceId, record.id),
    enabled: props.open,
  });
  const canArchive =
    !props.isArchiving &&
    (!removeWorktree ||
      (preview.isSuccess && !preview.isFetching && preview.data.branchName !== null));
  return (
    <ArchiveDialog
      {...props}
      record={record}
      canArchive={canArchive}
      removeWorktree={removeWorktree}
      onConfirm={() =>
        props.onArchive(
          removeWorktree,
          removeWorktree && preview.data?.branchName
            ? {
                workingDirectory: record.executionTarget.workingDirectory,
                branchName: preview.data.branchName,
              }
            : undefined,
        )
      }
    >
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center gap-3">
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Label htmlFor={switchId} className="flex-1 cursor-pointer leading-5">
            Remove worktree and branch
          </Label>
          <Switch
            id={switchId}
            checked={removeWorktree}
            onCheckedChange={setRemoveWorktree}
            disabled={props.isArchiving}
          />
        </div>
        <ArchiveWorktreeNotice removeWorktree={removeWorktree} preview={preview} />
        <WorktreeArchivePreview preview={preview} removeWorktree={removeWorktree} />
      </div>
    </ArchiveDialog>
  );
}

function ArchiveWorktreeNotice({
  removeWorktree,
  preview,
}: {
  removeWorktree: boolean;
  preview: UseQueryResult<WorkspaceSessionArchivePreview>;
}): ReactElement {
  if (!removeWorktree)
    return (
      <p className="text-sm text-muted-foreground">
        {preview.data?.worktreeExists === false
          ? "The worktree is missing. Restore the worktree at this path before restoring the chat."
          : "The worktree and its branch will stay on disk."}
      </p>
    );
  if (preview.isSuccess && preview.data.branchName === null)
    return (
      <p className="text-sm text-muted-foreground">
        No branch is attached. Turn off worktree removal to archive this chat.
      </p>
    );
  return (
    <p className="text-sm text-muted-foreground">
      Branch <span className="font-mono">{preview.data?.branchName ?? "…"}</span> will be deleted.
      Commits that exist only on this branch may be lost. Restoring this chat creates a fresh
      worktree from the default branch. It does not recover deleted changes.
    </p>
  );
}
