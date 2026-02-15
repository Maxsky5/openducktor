import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pickRepositoryDirectory } from "@/lib/repo-directory";
import { workspaceLabelFromPath } from "@/lib/workspace-label";
import { useOrchestrator } from "@/state/orchestrator-context";
import { CheckCircle2, FolderOpen, Sparkles } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

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
    useOrchestrator();
  const [isPickingRepo, setIsPickingRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isModalBusy = isPickingRepo || isSwitchingWorkspace;
  const sortedRecent = useMemo(
    () => [...workspaces].sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [workspaces],
  );

  const openSelectedRepo = async (): Promise<void> => {
    setIsPickingRepo(true);
    setError(null);
    try {
      const path = await pickRepositoryDirectory();
      if (!path) {
        return;
      }

      await addWorkspace(path);
      onOpenChange(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setIsPickingRepo(false);
    }
  };

  const selectRecentWorkspace = async (repoPath: string): Promise<void> => {
    setError(null);
    try {
      if (repoPath !== activeRepo) {
        await selectWorkspace(repoPath);
      }
      onOpenChange(false);
    } catch (reason) {
      setError((reason as Error).message);
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
        showCloseButton={canClose}
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
            <Sparkles className="size-5 text-sky-600" />
            Open a Repository
          </DialogTitle>
          <DialogDescription>
            Select the repository you want to orchestrate. OpenBlueprint will contextualize Kanban,
            Planner, and Builder to this repo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void openSelectedRepo()}
            disabled={isModalBusy}
          >
            <FolderOpen className="size-4" />
            {isPickingRepo ? "Opening directory picker..." : "Choose Repository Folder"}
          </Button>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">Recent Workspaces</p>
            {sortedRecent.length === 0 ? (
              <p className="text-sm text-slate-500">No repositories configured yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {sortedRecent.map((workspace) => (
                  <Button
                    key={workspace.path}
                    type="button"
                    variant="outline"
                    className="h-auto justify-between gap-3 overflow-hidden px-3 py-2 text-left"
                    disabled={isModalBusy}
                    onClick={() => void selectRecentWorkspace(workspace.path)}
                  >
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {workspaceLabelFromPath(workspace.path, { includeParent: true })}
                    </span>
                    {workspace.path === activeRepo ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        <CheckCircle2 className="size-3" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        Switch
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {canClose ? (
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
