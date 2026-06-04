import { CheckCircle2, FolderOpen, Sparkles } from "lucide-react";
import { type ReactElement, useMemo, useReducer } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";
import { FolderPickerDialog } from "./folder-picker-dialog";

const WORKSPACE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const deriveWorkspaceNameFromRepoPath = (repoPath: string): string => {
  const trimmedPath = repoPath.trim().replace(/[\\/]+$/, "");
  if (!trimmedPath) {
    return repoPath.trim();
  }

  const segments = trimmedPath.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments.at(-1)?.trim() || repoPath.trim();
};

const proposeWorkspaceId = (input: string): string => {
  let normalized = "";
  let lastWasDash = false;

  for (const character of input.trim().toLowerCase()) {
    const isAlphaNumeric =
      (character >= "a" && character <= "z") || (character >= "0" && character <= "9");
    if (isAlphaNumeric) {
      normalized += character;
      lastWasDash = false;
      continue;
    }

    if (!lastWasDash && normalized.length > 0) {
      normalized += "-";
      lastWasDash = true;
    }
  }

  while (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || "workspace";
};

const uniquifyWorkspaceId = (candidate: string, existingIds: Set<string>): string => {
  if (!existingIds.has(candidate)) {
    return candidate;
  }

  let suffix = 2;
  while (existingIds.has(`${candidate}-${suffix}`)) {
    suffix += 1;
  }
  return `${candidate}-${suffix}`;
};

type OpenRepositoryModalProps = {
  open: boolean;
  canClose: boolean;
  onOpenChange: (open: boolean) => void;
};

type OpenRepositoryState = {
  isFolderPickerOpen: boolean;
  selectedRepoPath: string | null;
  workspaceName: string;
  workspaceId: string;
  hasEditedWorkspaceId: boolean;
  isCreatingWorkspace: boolean;
  error: string | null;
};

type OpenRepositoryAction =
  | { type: "folderPickerOpened" }
  | { type: "folderPickerChanged"; open: boolean }
  | {
      type: "repoConfirmed";
      repoPath: string;
      workspaceName: string;
      workspaceId: string;
    }
  | { type: "workspaceIdChanged"; workspaceId: string }
  | { type: "workspaceNameChanged"; workspaceName: string; workspaceId: string }
  | { type: "creationStarted" }
  | { type: "operationFailed"; error: string }
  | { type: "creationFinished" };

const initialOpenRepositoryState: OpenRepositoryState = {
  isFolderPickerOpen: false,
  selectedRepoPath: null,
  workspaceName: "",
  workspaceId: "",
  hasEditedWorkspaceId: false,
  isCreatingWorkspace: false,
  error: null,
};

const openRepositoryReducer = (
  state: OpenRepositoryState,
  action: OpenRepositoryAction,
): OpenRepositoryState => {
  switch (action.type) {
    case "folderPickerOpened":
      return { ...state, error: null, isFolderPickerOpen: true };
    case "folderPickerChanged":
      return { ...state, isFolderPickerOpen: action.open };
    case "repoConfirmed":
      return {
        ...state,
        selectedRepoPath: action.repoPath,
        workspaceName: action.workspaceName,
        workspaceId: action.workspaceId,
        hasEditedWorkspaceId: false,
        error: null,
      };
    case "workspaceIdChanged":
      return {
        ...state,
        workspaceId: action.workspaceId,
        hasEditedWorkspaceId: true,
      };
    case "workspaceNameChanged":
      return {
        ...state,
        workspaceName: action.workspaceName,
        workspaceId: action.workspaceId,
      };
    case "creationStarted":
      return { ...state, error: null, isCreatingWorkspace: true };
    case "operationFailed":
      return { ...state, error: action.error };
    case "creationFinished":
      return { ...state, isCreatingWorkspace: false };
  }
};

function OpenRepositoryWorkspaceIdentity({
  existingWorkspaceIds,
  form,
  isModalBusy,
  onChange,
}: {
  existingWorkspaceIds: Set<string>;
  form: {
    hasEditedWorkspaceId: boolean;
    selectedRepoPath: string;
    workspaceId: string;
    workspaceName: string;
  };
  isModalBusy: boolean;
  onChange: (action: OpenRepositoryAction) => void;
}): ReactElement {
  const { hasEditedWorkspaceId, selectedRepoPath, workspaceId, workspaceName } = form;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Review workspace identity</p>
        <p className="text-sm text-muted-foreground">
          OpenDucktor will use this ID as the durable workspace identity. You can edit the name and
          ID before initialization.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="open-repo-path">Repository path</Label>
        <Input
          id="open-repo-path"
          value={selectedRepoPath}
          readOnly
          disabled={isModalBusy}
          className="font-mono"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="open-workspace-id">Workspace ID</Label>
        <Input
          id="open-workspace-id"
          value={workspaceId}
          disabled={isModalBusy}
          className="font-mono"
          onChange={(event) => {
            onChange({
              type: "workspaceIdChanged",
              workspaceId: event.currentTarget.value.trim(),
            });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Use lowercase letters, digits, and dashes only.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="open-workspace-name">Workspace name</Label>
        <Input
          id="open-workspace-name"
          value={workspaceName}
          disabled={isModalBusy}
          onChange={(event) => {
            const nextWorkspaceName = event.currentTarget.value;
            const nextWorkspaceId = hasEditedWorkspaceId
              ? workspaceId
              : uniquifyWorkspaceId(proposeWorkspaceId(nextWorkspaceName), existingWorkspaceIds);
            onChange({
              type: "workspaceNameChanged",
              workspaceName: nextWorkspaceName,
              workspaceId: nextWorkspaceId,
            });
          }}
        />
      </div>
    </div>
  );
}

function OpenRepositoryModalSession({
  open,
  canClose,
  onOpenChange,
}: OpenRepositoryModalProps): ReactElement {
  const { activeWorkspace, workspaces, addWorkspace, selectWorkspace, isSwitchingWorkspace } =
    useWorkspaceState();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const [state, dispatch] = useReducer(openRepositoryReducer, initialOpenRepositoryState);
  const {
    isFolderPickerOpen,
    selectedRepoPath,
    workspaceName,
    workspaceId,
    hasEditedWorkspaceId,
    isCreatingWorkspace,
    error,
  } = state;

  const isModalBusy = isSwitchingWorkspace || isCreatingWorkspace;
  const sortedRecent = useMemo(
    () => workspaces.toSorted((a, b) => Number(b.isActive) - Number(a.isActive)),
    [workspaces],
  );
  const existingWorkspaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.workspaceId)),
    [workspaces],
  );
  const selectedExistingWorkspace = useMemo(
    () =>
      selectedRepoPath
        ? (workspaces.find((workspace) => workspace.repoPath === selectedRepoPath) ?? null)
        : null,
    [selectedRepoPath, workspaces],
  );

  const workspaceValidationError = useMemo(() => {
    if (!selectedRepoPath) {
      return null;
    }
    if (selectedExistingWorkspace) {
      return `Repository is already configured as ${selectedExistingWorkspace.workspaceName}.`;
    }
    if (workspaceName.trim().length === 0) {
      return "Workspace name cannot be blank.";
    }
    if (workspaceId.trim().length === 0) {
      return "Workspace ID cannot be blank.";
    }
    if (!WORKSPACE_ID_PATTERN.test(workspaceId.trim())) {
      return "Workspace ID must contain only lowercase letters, digits, and single dashes.";
    }
    if (existingWorkspaceIds.has(workspaceId.trim())) {
      return `Workspace ID already exists: ${workspaceId.trim()}`;
    }
    return null;
  }, [
    existingWorkspaceIds,
    selectedExistingWorkspace,
    selectedRepoPath,
    workspaceId,
    workspaceName,
  ]);

  const openSelectedRepo = (): void => {
    dispatch({ type: "folderPickerOpened" });
  };

  const confirmSelectedRepo = async (path: string): Promise<void> => {
    const nextWorkspaceName = deriveWorkspaceNameFromRepoPath(path);
    const nextWorkspaceId = uniquifyWorkspaceId(
      proposeWorkspaceId(nextWorkspaceName),
      existingWorkspaceIds,
    );
    dispatch({
      type: "repoConfirmed",
      repoPath: path,
      workspaceName: nextWorkspaceName,
      workspaceId: nextWorkspaceId,
    });
  };

  const submitWorkspaceCreation = async (): Promise<void> => {
    if (!selectedRepoPath || workspaceValidationError) {
      return;
    }

    dispatch({ type: "creationStarted" });
    try {
      await addWorkspace({
        workspaceId: workspaceId.trim(),
        workspaceName: workspaceName.trim(),
        repoPath: selectedRepoPath,
      });
      onOpenChange(false);
    } catch (reason) {
      dispatch({ type: "operationFailed", error: errorMessage(reason) });
    } finally {
      dispatch({ type: "creationFinished" });
    }
  };

  const selectRecentWorkspace = async (workspaceId: string): Promise<void> => {
    try {
      const selectedWorkspace = workspaces.find(
        (workspace) => workspace.workspaceId === workspaceId,
      );
      if (!selectedWorkspace) {
        throw new Error("Workspace not found.");
      }

      if (selectedWorkspace.repoPath !== workspaceRepoPath) {
        await selectWorkspace(workspaceId);
      }
      onOpenChange(false);
    } catch (reason) {
      dispatch({ type: "operationFailed", error: errorMessage(reason) });
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

        <DialogBody className="space-y-4 py-4">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={openSelectedRepo}
            disabled={isModalBusy}
          >
            <FolderOpen className="size-4" />
            {selectedRepoPath ? "Choose Different Repository Folder" : "Choose Repository Folder"}
          </Button>

          {selectedRepoPath ? (
            <OpenRepositoryWorkspaceIdentity
              existingWorkspaceIds={existingWorkspaceIds}
              form={{
                hasEditedWorkspaceId,
                selectedRepoPath,
                workspaceId,
                workspaceName,
              }}
              isModalBusy={isModalBusy}
              onChange={dispatch}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose a repository folder to review the proposed workspace ID and name before
              initialization.
            </p>
          )}

          {error || workspaceValidationError ? (
            <div className="rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted">
              {error ?? workspaceValidationError}
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
                    {workspace.repoPath === workspaceRepoPath ? (
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

        {canClose || selectedRepoPath ? (
          <DialogFooter className="mt-0 border-t border-border pt-5 justify-between">
            {canClose ? (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            ) : null}
            {selectedRepoPath ? (
              <Button
                type="button"
                onClick={() => void submitWorkspaceCreation()}
                disabled={isModalBusy || workspaceValidationError !== null}
                className="ml-auto"
              >
                Open Repository
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>

      {isFolderPickerOpen ? (
        <FolderPickerDialog
          open={isFolderPickerOpen}
          onOpenChange={(nextOpen) => dispatch({ type: "folderPickerChanged", open: nextOpen })}
          title="Open Repository"
          description="Browse to an existing Git repository on disk, then review the proposed workspace ID and name before initialization."
          confirmLabel="Choose This Folder"
          requireGitRepo
          onConfirm={confirmSelectedRepo}
        />
      ) : null}
    </Dialog>
  );
}

export function OpenRepositoryModal(props: OpenRepositoryModalProps): ReactElement {
  return <OpenRepositoryModalSession key={props.open ? "open" : "closed"} {...props} />;
}
