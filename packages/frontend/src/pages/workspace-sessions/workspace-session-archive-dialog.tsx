import type {
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
  WorkspaceSessionArchivePreview,
} from "@openducktor/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
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
  workspaceId: string;
  record: WorkspaceSession;
  isArchiving: boolean;
  error: Error | null;
  onArchive: (
    removeWorktree: boolean,
    confirmation?: WorkspaceSessionArchiveInput["worktreeConfirmation"],
  ) => void;
  onClose: () => void;
};

function ArchiveWorktreeNotice({
  removeWorktree,
  preview,
}: {
  removeWorktree: boolean;
  preview: UseQueryResult<WorkspaceSessionArchivePreview>;
}) {
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

export function WorkspaceSessionArchiveDialog({
  workspaceId,
  record,
  isArchiving,
  error,
  onArchive,
  onClose,
}: Props) {
  const [removeWorktree, setRemoveWorktree] = useState(true);
  const switchId = useId();
  const preview = useQuery(workspaceSessionArchivePreviewQueryOptions(workspaceId, record.id));
  const canArchive =
    !isArchiving &&
    (!removeWorktree ||
      (preview.isSuccess && !preview.isFetching && preview.data.branchName !== null));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isArchiving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" closeButton={isArchiving ? null : undefined}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canArchive)
              onArchive(
                removeWorktree,
                removeWorktree && preview.data?.branchName
                  ? {
                      workingDirectory: record.executionTarget.workingDirectory,
                      branchName: preview.data.branchName,
                    }
                  : undefined,
              );
          }}
        >
          <DialogHeader>
            <DialogTitle>Archive chat</DialogTitle>
            <DialogDescription>
              Archive "{workspaceSessionTitle(record)}". Your chat history will stay available.
              {" Archiving stops this session if it is running."}
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={isArchiving}>
            <DialogBody className="mt-4 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor={switchId}>Remove worktree and branch</Label>
                <Switch
                  id={switchId}
                  checked={removeWorktree}
                  onCheckedChange={setRemoveWorktree}
                  disabled={isArchiving}
                />
              </div>
              <p className="break-all text-xs text-muted-foreground">
                {record.executionTarget.workingDirectory}
              </p>
              <ArchiveWorktreeNotice removeWorktree={removeWorktree} preview={preview} />
              <WorktreeArchivePreview preview={preview} removeWorktree={removeWorktree} />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(error)}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={removeWorktree ? "destructive" : "default"}
                disabled={!canArchive}
              >
                {isArchiving && (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden="true"
                  />
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
