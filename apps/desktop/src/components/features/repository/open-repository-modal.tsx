import { CheckCircle2, FolderOpen, Sparkles } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
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
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";
import { FolderPickerDialog } from "./folder-picker-dialog";

type OpenRepositoryModalProps = {
  open: boolean;
  canClose: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OpenRepositoryModal({
  open,
  canClose,
  onOpenChange,
}: OpenRepositoryModalProps): ReactElement {
  const { activeRepo, workspaces, addWorkspace, selectWorkspace, isSwitchingWorkspace } =
    useWorkspaceState();
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setIsFolderPickerOpen(false);
    }
  }, [open]);

  const isModalBusy = isSwitchingWorkspace;
  const sortedRecent = useMemo(
    () => [...workspaces].sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [workspaces],
  );

  const openSelectedRepo = (): void => {
    setError(null);
    setIsFolderPickerOpen(true);
  };

  const confirmSelectedRepo = async (path: string): Promise<void> => {
    setError(null);
    try {
      await addWorkspace(path);
      onOpenChange(false);
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      throw reason;
    }
  };

  const selectRecentWorkspace = async (workspaceId: string): Promise<void> => {
    setError(null);
    try {
      const selectedWorkspace = workspaces.find(
        (workspace) => workspace.workspaceId === workspaceId,
      );
      if (!selectedWorkspace) {
        throw new Error("Workspace not found.");
      }

      if (selectedWorkspace.repoPath !== activeRepo) {
        await selectWorkspace(workspaceId);
      }
      onOpenChange(false);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !canClose) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-3xl"
        {...(canClose ? {} : { closeButton: null })}
        onEscapeKeyDown={(event) => {
          if (!canClose) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (!canClose) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="size-5 text-primary" />
            Open a Repository
          </DialogTitle>
          <DialogDescription>
            Select the repository you want to orchestrate. OpenDucktor will contextualize Kanban,
            Planner, and Builder to this repo.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 pt-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={openSelectedRepo}
            disabled={isModalBusy}
          >
            <FolderOpen className="size-4" />
            Choose Repository Folder
          </Button>

          {error ? (
            <div className="rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted">
              {error}
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Recent Workspaces</p>
            {sortedRecent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No repositories configured yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {sortedRecent.map((workspace) => (
                  <Button
                    key={workspace.workspaceId}
                    type="button"
                    variant="outline"
                    className="h-auto justify-between gap-3 overflow-hidden px-3 py-2 text-left"
                    disabled={isModalBusy}
                    onClick={() => void selectRecentWorkspace(workspace.workspaceId)}
                  >
                    <span className="truncate text-sm font-semibold text-foreground">
                      {workspace.workspaceName}
                    </span>
                    {workspace.repoPath === activeRepo ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success-border bg-success-surface px-2 py-0.5 text-[11px] font-semibold text-success-muted">
                        <CheckCircle2 className="size-3" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Switch
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </DialogBody>

        {canClose ? (
          <DialogFooter className="mt-0 border-t border-border pt-5">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>

      {isFolderPickerOpen ? (
        <FolderPickerDialog
          open={isFolderPickerOpen}
          onOpenChange={setIsFolderPickerOpen}
          title="Open Repository"
          description="Browse to an existing Git repository on disk. OpenDucktor will register the selected path in place."
          confirmLabel="Open Repository"
          requireGitRepo
          onConfirm={confirmSelectedRepo}
        />
      ) : null}
    </Dialog>
  );
}
