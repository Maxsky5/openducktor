import { CheckCircle2, Sparkles } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
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
import { WorkspaceCreationForm } from "./workspace-creation-form";

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
  const { activeWorkspace, workspaces, addWorkspace, selectWorkspace, isSwitchingWorkspace } =
    useWorkspaceState();
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const sortedRecent = useMemo(
    () => workspaces.toSorted((left, right) => Number(right.isActive) - Number(left.isActive)),
    [workspaces],
  );

  const selectRecentWorkspace = async (workspaceId: string): Promise<void> => {
    setSelectionError(null);
    try {
      if (activeWorkspace?.workspaceId !== workspaceId) await selectWorkspace(workspaceId);
      onOpenChange(false);
    } catch (cause) {
      setSelectionError(errorMessage(cause));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || canClose) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-3xl"
        {...(canClose ? {} : { closeButton: null })}
        onEscapeKeyDown={(event) => {
          if (!canClose) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!canClose) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Sparkles />
            Open a Repository
          </DialogTitle>
          <DialogDescription>
            Choose a local Git repository and review its workspace identity.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-5 py-4">
          <WorkspaceCreationForm
            workspaces={workspaces}
            addWorkspace={addWorkspace}
            disabled={isSwitchingWorkspace}
            onSuccess={() => onOpenChange(false)}
          />

          <section className="flex flex-col gap-2" aria-labelledby="recent-workspaces-title">
            <h3 id="recent-workspaces-title" className="text-sm font-semibold text-foreground">
              Recent Workspaces
            </h3>
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
                    disabled={isSwitchingWorkspace}
                    onClick={() => void selectRecentWorkspace(workspace.workspaceId)}
                  >
                    <span className="truncate">{workspace.workspaceName}</span>
                    {workspace.isActive ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle2 />
                        Active
                      </span>
                    ) : null}
                  </Button>
                ))}
              </div>
            )}
            {selectionError ? (
              <p className="text-sm text-destructive" role="alert">
                {selectionError}
              </p>
            ) : null}
          </section>
        </DialogBody>

        {canClose ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
