import type { WorkspaceRecord } from "@openducktor/contracts";
import { FolderOpen } from "lucide-react";
import { type ReactElement, useMemo, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import type { WorkspaceSelectionOperationsInput } from "@/types/state-slices";
import {
  FolderPickerDialog,
  InlineFolderPicker,
  type InlineFolderPickerProps,
} from "./folder-picker-dialog";

const WORKSPACE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const deriveWorkspaceNameFromRepoPath = (repoPath: string): string => {
  const trimmedPath = repoPath.trim().replace(/[\\/]+$/, "");
  const segments = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1)?.trim() || repoPath.trim();
};

export const proposeWorkspaceId = (input: string): string => {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workspace";
};

export const uniquifyWorkspaceId = (candidate: string, existingIds: Set<string>): string => {
  if (!existingIds.has(candidate)) return candidate;
  let suffix = 2;
  while (existingIds.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
};

type State = {
  pickerOpen: boolean;
  repoPath: string;
  workspaceName: string;
  workspaceId: string;
  editedId: boolean;
  submitting: boolean;
  error: string | null;
};

type Action =
  | { type: "picker"; open: boolean }
  | { type: "repo"; repoPath: string; workspaceName: string; workspaceId: string }
  | { type: "name"; workspaceName: string; workspaceId: string }
  | { type: "id"; workspaceId: string }
  | { type: "submitting"; value: boolean }
  | { type: "error"; error: string | null };

const initialState: State = {
  pickerOpen: false,
  repoPath: "",
  workspaceName: "",
  workspaceId: "",
  editedId: false,
  submitting: false,
  error: null,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "picker":
      return { ...state, pickerOpen: action.open, error: null };
    case "repo":
      return { ...state, ...action, pickerOpen: false, editedId: false, error: null };
    case "name":
      return { ...state, workspaceName: action.workspaceName, workspaceId: action.workspaceId };
    case "id":
      return { ...state, workspaceId: action.workspaceId, editedId: true };
    case "submitting":
      return { ...state, submitting: action.value };
    case "error":
      return { ...state, error: action.error };
  }
};

type WorkspaceCreationFormProps = {
  workspaces: WorkspaceRecord[];
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<void>;
  disabled?: boolean;
  repositoryPicker?: "dialog" | "inline";
  renderActions?: InlineFolderPickerProps["renderActions"];
  onSubmittingChange?: (submitting: boolean) => void;
  onSuccess?: () => void;
};

export function WorkspaceCreationForm({
  workspaces,
  addWorkspace,
  disabled = false,
  repositoryPicker = "dialog",
  renderActions,
  onSubmittingChange,
  onSuccess,
}: WorkspaceCreationFormProps): ReactElement {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    pickerOpen: repositoryPicker === "inline",
  });
  const submitInFlight = useRef(false);
  const existingIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.workspaceId)),
    [workspaces],
  );
  const duplicateRepo = workspaces.find((workspace) => workspace.repoPath === state.repoPath);
  let validationError: string | null = null;
  if (state.repoPath) {
    if (duplicateRepo)
      validationError = `Repository is already configured as ${duplicateRepo.workspaceName}.`;
    else if (!state.workspaceName.trim()) validationError = "Workspace name cannot be blank.";
    else if (!WORKSPACE_ID_PATTERN.test(state.workspaceId.trim()))
      validationError =
        "Workspace ID must contain only lowercase letters, digits, and single dashes.";
    else if (existingIds.has(state.workspaceId.trim()))
      validationError = `Workspace ID already exists: ${state.workspaceId.trim()}`;
  }
  const busy = disabled || state.submitting;

  const confirmRepo = (repoPath: string): void => {
    const workspaceName = deriveWorkspaceNameFromRepoPath(repoPath);
    dispatch({
      type: "repo",
      repoPath,
      workspaceName,
      workspaceId: uniquifyWorkspaceId(proposeWorkspaceId(workspaceName), existingIds),
    });
  };

  const submit = async (): Promise<void> => {
    if (submitInFlight.current || !state.repoPath || validationError) return;
    submitInFlight.current = true;
    onSubmittingChange?.(true);
    dispatch({ type: "submitting", value: true });
    dispatch({ type: "error", error: null });
    try {
      await addWorkspace({
        workspaceId: state.workspaceId.trim(),
        workspaceName: state.workspaceName.trim(),
        repoPath: state.repoPath,
      });
      onSuccess?.();
    } catch (cause) {
      dispatch({ type: "error", error: errorMessage(cause) });
    } finally {
      submitInFlight.current = false;
      dispatch({ type: "submitting", value: false });
      onSubmittingChange?.(false);
    }
  };

  const submitAction =
    state.repoPath && !state.pickerOpen ? (
      <Button
        type="button"
        disabled={busy || validationError !== null}
        onClick={() => void submit()}
      >
        {state.submitting ? "Opening repository..." : "Open repository"}
      </Button>
    ) : null;

  return (
    <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
      {repositoryPicker === "dialog" || (state.repoPath && !state.pickerOpen) ? (
        <Button
          type="button"
          size={state.repoPath ? "default" : "lg"}
          variant={state.repoPath ? "outline" : "default"}
          className={state.repoPath ? "w-fit" : undefined}
          onClick={() => dispatch({ type: "picker", open: true })}
        >
          <FolderOpen data-icon="inline-start" />
          {state.repoPath ? "Choose different repository" : "Choose repository folder"}
        </Button>
      ) : null}

      {repositoryPicker === "inline" && state.pickerOpen ? (
        <InlineFolderPicker
          title="Repository browser"
          description="Choose an existing Git repository on disk."
          confirmLabel="Choose This Folder"
          requireGitRepo
          onConfirm={confirmRepo}
          {...(renderActions ? { renderActions } : {})}
          {...(state.repoPath
            ? {
                initialPath: state.repoPath,
                onCancel: () => dispatch({ type: "picker", open: false }),
              }
            : {})}
        />
      ) : null}

      {state.repoPath && !state.pickerOpen ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="workspace-repo-path">Repository path</Label>
            <Input id="workspace-repo-path" value={state.repoPath} readOnly />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="workspace-id">Workspace ID</Label>
            <Input
              id="workspace-id"
              value={state.workspaceId}
              aria-invalid={validationError?.startsWith("Workspace ID") ?? false}
              onChange={(event) =>
                dispatch({ type: "id", workspaceId: event.currentTarget.value.trim() })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={state.workspaceName}
              onChange={(event) => {
                const workspaceName = event.currentTarget.value;
                dispatch({
                  type: "name",
                  workspaceName,
                  workspaceId: state.editedId
                    ? state.workspaceId
                    : uniquifyWorkspaceId(proposeWorkspaceId(workspaceName), existingIds),
                });
              }}
            />
          </div>
        </div>
      ) : null}

      {state.error || validationError ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error ?? validationError}
        </p>
      ) : null}

      {submitAction
        ? (renderActions?.({ primaryAction: submitAction, secondaryAction: null }) ?? submitAction)
        : null}

      {repositoryPicker === "dialog" && state.pickerOpen ? (
        <FolderPickerDialog
          open
          onOpenChange={(open) => dispatch({ type: "picker", open })}
          title="Open Repository"
          description="Choose an existing Git repository on disk."
          confirmLabel="Choose This Folder"
          requireGitRepo
          onConfirm={confirmRepo}
        />
      ) : null}
    </fieldset>
  );
}
