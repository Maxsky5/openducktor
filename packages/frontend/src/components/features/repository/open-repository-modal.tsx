import { ArrowLeft, Sparkles } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state/app-state-provider";
import { FolderPickerDialog } from "./folder-picker-dialog";
import { OpenRepositoryChoices } from "./open-repository-choices";
import {
  WorkspaceCreationBackAction,
  WorkspaceCreationFields,
  WorkspaceCreationSubmitAction,
} from "./workspace-creation-form";
import { useWorkspaceCreation, type WorkspaceCreationController } from "./use-workspace-creation";
import {
  useWorkspaceCreationModels,
  type WorkspaceCreationModelSurface,
} from "./use-workspace-creation-models";

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

function useGuardedWorkspaceChange(
  requestTransition: OpenRepositoryModalProps["requestTransition"],
) {
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
  return { isChangingWorkspace, runWorkspaceChange };
}

function useClosedWorkspaceReopen({
  runWorkspaceChange,
  reopenWorkspace,
  onOpenChange,
  disabled,
}: {
  runWorkspaceChange: (change: () => Promise<void>) => Promise<boolean>;
  reopenWorkspace: (input: { workspaceId: string; expectedRepoPath: string }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
}) {
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const reopenClosedWorkspace = async (workspaceId: string, repoPath: string): Promise<void> => {
    if (disabled) return;
    setSelectionError(null);
    try {
      if (
        !(await runWorkspaceChange(() =>
          reopenWorkspace({ workspaceId, expectedRepoPath: repoPath }),
        ))
      )
        return;
      onOpenChange(false);
    } catch (cause) {
      setSelectionError(errorMessage(cause));
    }
  };
  return { selectionError, reopenClosedWorkspace };
}

function OpenRepositoryModalFooter({
  canClose,
  interactionLocked,
  showCreationFlow,
  creation,
  models,
  onClose,
  onBackToWorkspaces,
}: {
  canClose: boolean;
  interactionLocked: boolean;
  showCreationFlow: boolean;
  creation: WorkspaceCreationController;
  models: WorkspaceCreationModelSurface;
  onClose: () => void;
  onBackToWorkspaces: () => void;
}): ReactElement {
  return (
    <DialogFooter
      className="mt-0 flex-col-reverse items-stretch justify-between gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center"
      role="group"
      aria-label="Repository actions"
    >
      <div className="flex flex-wrap gap-2">
        {canClose ? (
          <Button type="button" variant="outline" disabled={interactionLocked} onClick={onClose}>
            Close
          </Button>
        ) : null}
        {showCreationFlow && creation.stage === "repository" && !creation.pickerOpen ? (
          <Button
            type="button"
            variant="outline"
            disabled={interactionLocked}
            onClick={onBackToWorkspaces}
          >
            <ArrowLeft data-icon="inline-start" /> Back to workspaces
          </Button>
        ) : null}
        {showCreationFlow ? <WorkspaceCreationBackAction controller={creation} /> : null}
      </div>
      {showCreationFlow ? (
        <div className="w-full sm:w-auto [&>button]:w-full">
          <WorkspaceCreationSubmitAction controller={creation} modelSurface={models} />
        </div>
      ) : null}
    </DialogFooter>
  );
}

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
  const { isChangingWorkspace, runWorkspaceChange } = useGuardedWorkspaceChange(requestTransition);
  const [showCreationFlow, setShowCreationFlow] = useState(false);
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
    active: open && showCreationFlow && creation.stage === "models",
    saveAgentModelFavorites,
  });
  const interactionLocked = isSwitchingWorkspace || isCreatingWorkspace || isChangingWorkspace;
  const { selectionError, reopenClosedWorkspace } = useClosedWorkspaceReopen({
    runWorkspaceChange,
    reopenWorkspace,
    onOpenChange,
    disabled: interactionLocked,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || (canClose && !interactionLocked)) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className={cn(
          "grid max-h-[92vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0",
          showCreationFlow || closedWorkspaces.length > 0 ? "max-w-6xl" : "max-w-2xl",
        )}
        {...(canClose && !interactionLocked ? {} : { closeButton: null })}
        onEscapeKeyDown={(event) => {
          if (!canClose || interactionLocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!canClose || interactionLocked) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="size-5 text-primary" />
            Open a repository
          </DialogTitle>
          <DialogDescription>
            {showCreationFlow
              ? "Choose a Git folder, review workspace details, and set model defaults."
              : closedWorkspaces.length > 0
                ? "Start a new workspace or reopen one you closed earlier."
                : "Choose a local Git repository to start a workspace."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="px-6 py-5">
          {showCreationFlow ? (
            <WorkspaceCreationFields controller={creation} modelSurface={models} />
          ) : (
            <OpenRepositoryChoices
              closedWorkspaces={closedWorkspaces}
              disabled={interactionLocked}
              error={selectionError}
              onChooseNew={() => {
                setShowCreationFlow(true);
                creation.openPicker();
              }}
              onReopen={(workspaceId, repoPath) => {
                void reopenClosedWorkspace(workspaceId, repoPath);
              }}
            />
          )}
        </DialogBody>

        <OpenRepositoryModalFooter
          canClose={canClose}
          interactionLocked={interactionLocked}
          showCreationFlow={showCreationFlow}
          creation={creation}
          models={models}
          onClose={() => onOpenChange(false)}
          onBackToWorkspaces={() => setShowCreationFlow(false)}
        />
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
