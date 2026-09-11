import { Sparkles } from "lucide-react";
import { type ReactElement, useState } from "react";
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
  const {
    workspaces,
    closedWorkspaces,
    addWorkspace,
    reopenWorkspace,
    resolveWorkspacePath,
    isSwitchingWorkspace,
  } = useWorkspaceState();
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const interactionLocked = isSwitchingWorkspace || isCreatingWorkspace;

  const reopenClosedWorkspace = async (
    workspaceId: string,
    expectedRepoPath: string,
  ): Promise<void> => {
    setSelectionError(null);
    try {
      await reopenWorkspace({ workspaceId, expectedRepoPath });
      onOpenChange(false);
    } catch (cause) {
      setSelectionError(errorMessage(cause));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || (canClose && !interactionLocked)) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-3xl"
        {...(canClose && !interactionLocked ? {} : { closeButton: null })}
        onEscapeKeyDown={(event) => {
          if (!canClose || interactionLocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!canClose || interactionLocked) event.preventDefault();
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
            resolveRepoPath={resolveWorkspacePath}
            onReopenClosedWorkspace={async (workspace) => {
              await reopenWorkspace({
                workspaceId: workspace.workspaceId,
                expectedRepoPath: workspace.repoPath,
              });
            }}
            disabled={interactionLocked}
            onSubmittingChange={setIsCreatingWorkspace}
            onSuccess={() => onOpenChange(false)}
          />

          <section className="flex flex-col gap-2" aria-labelledby="closed-workspaces-title">
            <h3 id="closed-workspaces-title" className="text-sm font-semibold text-foreground">
              Closed workspaces
            </h3>
            {closedWorkspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">No closed workspaces</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {closedWorkspaces.map((workspace) => (
                  <Button
                    key={workspace.workspaceId}
                    type="button"
                    variant="outline"
                    className="h-auto flex-col items-start gap-1 overflow-hidden px-3 py-2 text-left"
                    disabled={interactionLocked}
                    onClick={() =>
                      void reopenClosedWorkspace(workspace.workspaceId, workspace.repoPath)
                    }
                  >
                    <span className="truncate">{workspace.workspaceName}</span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {workspace.repoPath}
                    </span>
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
            <Button
              type="button"
              variant="outline"
              disabled={interactionLocked}
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
