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
import { useWorkspaceState } from "@/state/app-state-provider";
import { FolderPickerDialog } from "./folder-picker-dialog";
import {
  WorkspaceCreationBackAction,
  WorkspaceCreationFields,
  WorkspaceCreationSubmitAction,
} from "./workspace-creation-form";
import { useWorkspaceCreation } from "./use-workspace-creation";
import { useWorkspaceCreationModels } from "./use-workspace-creation-models";

type OpenRepositoryModalProps = {
  open: boolean;
  canClose: boolean;
  onOpenChange: (open: boolean) => void;
  requestTransition: (
    apply: () => Promise<boolean>,
    cancel?: () => void,
    options?: { waitForSuccess?: boolean },
  ) => void;
};

function OpenRepositoryModalSession({
  open,
  canClose,
  onOpenChange,
  requestTransition,
}: OpenRepositoryModalProps): ReactElement {
  const {
    workspaces,
    closedWorkspaces,
    incompleteRemovals,
    addWorkspace,
    saveWorkspaceModelDefaults,
    saveAgentModelFavorites,
    reopenWorkspace,
    resolveWorkspacePath,
    isSwitchingWorkspace,
  } = useWorkspaceState();
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false);
  const runWorkspaceChange = async (change: () => Promise<void>): Promise<boolean> => {
    setIsChangingWorkspace(true);
    try {
      return await new Promise<boolean>((resolve, reject) => {
        requestTransition(
          async () => {
            try {
              await change();
              resolve(true);
              return true;
            } catch (cause) {
              reject(cause);
              return false;
            }
          },
          () => resolve(false),
          { waitForSuccess: true },
        );
      });
    } finally {
      setIsChangingWorkspace(false);
    }
  };
  const configuredWorkspaces = [
    ...workspaces,
    ...closedWorkspaces,
    ...incompleteRemovals.map((removal) => removal.workspace),
  ];
  const creation = useWorkspaceCreation({
    workspaces: configuredWorkspaces,
    addWorkspace,
    saveWorkspaceModelDefaults,
    resolveRepoPath: resolveWorkspacePath,
    onReopenClosedWorkspace: (workspace) =>
      reopenWorkspace({
        workspaceId: workspace.workspaceId,
        expectedRepoPath: workspace.repoPath,
      }),
    runWorkspaceChange,
    disabled: isSwitchingWorkspace || isChangingWorkspace,
    onSubmittingChange: setIsCreatingWorkspace,
    onSuccess: () => onOpenChange(false),
  });
  const models = useWorkspaceCreationModels({
    repoPath: creation.repoPath,
    active: open && creation.stage === "models",
    saveAgentModelFavorites,
  });
  const interactionLocked = isSwitchingWorkspace || isCreatingWorkspace || isChangingWorkspace;

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
            Choose a repository folder, review workspace information, then choose models.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-5 py-4">
          <WorkspaceCreationFields controller={creation} modelSurface={models} />
        </DialogBody>

        <DialogFooter
          className="flex-row justify-between"
          role="group"
          aria-label="Repository actions"
        >
          <div className="flex gap-2">
            {canClose ? (
              <Button
                type="button"
                variant="outline"
                disabled={interactionLocked}
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            ) : null}
            <WorkspaceCreationBackAction controller={creation} />
          </div>
          <WorkspaceCreationSubmitAction controller={creation} modelSurface={models} />
        </DialogFooter>
      </DialogContent>
      <FolderPickerDialog
        open={creation.pickerOpen}
        onOpenChange={(nextOpen) => (nextOpen ? creation.openPicker() : creation.closePicker())}
        title="Open Repository"
        description="Choose an existing Git repository on disk."
        confirmLabel="Choose This Folder"
        requireGitRepo
        onConfirm={creation.confirmRepo}
      />
    </Dialog>
  );
}

export function OpenRepositoryModal(props: OpenRepositoryModalProps): ReactElement | null {
  return props.open ? <OpenRepositoryModalSession {...props} /> : null;
}
