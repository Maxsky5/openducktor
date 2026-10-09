import type {
  WorkspacePathResolution,
  WorkspaceRecord,
  WorkspaceProviderSetupCommit,
  WorkspaceProviderSetupProgress,
} from "@openducktor/contracts";
import { useMemo, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import { prepareModelDefaultsForSave } from "@/lib/repo-agent-defaults";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
import {
  useWorkspaceProviderSetup,
  type WorkspaceProviderSetupController,
} from "./use-workspace-provider-setup";

export function useWorkspaceCreation({
  workspaces,
  commitWorkspaceProviderSetup,
  disabled = false,
  onSubmittingChange,
  onSuccess,
  resolveRepoPath,
  onReopenClosedWorkspace,
  runWorkspaceChange,
  initialPickerOpen = false,
}: WorkspaceCreationFormProps & { initialPickerOpen?: boolean }): WorkspaceCreationController {
  const [state, dispatch] = useReducer(reducer, { ...initialState, pickerOpen: initialPickerOpen });
  const provider = useWorkspaceProviderSetup();
  const resolvingRepo = useRef(false);
  const submitInFlight = useRef(false);
  const existingIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.workspaceId)),
    [workspaces],
  );
  const duplicateRepo = workspaces.find((workspace) => workspace.repoPath === state.repoPath);
  let validationError: string | null = null;
  if (state.repoPath && !state.createdWorkspaceId) {
    if (duplicateRepo)
      validationError = `Repository is already configured as ${duplicateRepo.workspaceName}.`;
    else if (!state.workspaceName.trim()) validationError = "Workspace name cannot be blank.";
    else if (!WORKSPACE_ID_PATTERN.test(state.workspaceId.trim()))
      validationError =
        "Workspace ID must contain only lowercase letters, digits, and single dashes.";
    else if (existingIds.has(state.workspaceId.trim()))
      validationError = `Workspace ID already exists: ${state.workspaceId.trim()}`;
  }
  const submitting = state.progress !== "idle";
  const busy = disabled || submitting || provider.pending !== null;
  const canAbandon =
    !disabled &&
    !submitting &&
    !provider.isCancelling &&
    (provider.pending === null || provider.isStartingSignIn);
  const runChange =
    runWorkspaceChange ??
    (async (change: () => Promise<void>) => {
      await change();
      return true;
    });

  const confirmRepo = async (repoPath: string): Promise<void> => {
    if (busy || submitInFlight.current || resolvingRepo.current || state.createdWorkspaceId) return;
    resolvingRepo.current = true;
    try {
      const resolution = await resolveRepoPath?.(repoPath);
      if (resolution?.kind === "removing") {
        throw new Error(
          `Workspace removal is incomplete for ${resolution.removal.workspace.workspaceName}. Retry removal from the workspace rail.`,
        );
      }
      if (resolution?.kind === "open") {
        throw new Error(
          `Repository is already configured as ${resolution.workspace.workspaceName}.`,
        );
      }
      if (resolution?.kind === "closed") {
        if (!onReopenClosedWorkspace) throw new Error("Cannot reopen this workspace from here.");
        if (!(await provider.discard()))
          throw new Error("Retry provider setup cleanup before reopening this workspace.");
        dispatch({ type: "reset", pickerOpen: state.pickerOpen });
        if (!(await runChange(() => onReopenClosedWorkspace(resolution.workspace)))) return;
        await onSuccess?.(resolution.workspace.repoPath);
        return;
      }
      const setup = await provider.begin(repoPath);
      const workspaceName = deriveWorkspaceNameFromRepoPath(setup.repoPath);
      dispatch({
        type: "repo",
        repoPath: setup.repoPath,
        workspaceName,
        workspaceId: uniquifyWorkspaceId(proposeWorkspaceId(workspaceName), existingIds),
      });
    } finally {
      resolvingRepo.current = false;
    }
  };

  const submit = async (): Promise<void> => {
    if (
      submitInFlight.current ||
      disabled ||
      state.stage !== "models" ||
      !state.repoPath ||
      validationError
    )
      return;
    submitInFlight.current = true;
    onSubmittingChange?.(true);
    dispatch({ type: "error", error: null, stage: null });
    dispatch({ type: "progress", value: "creating" });
    try {
      const completed = await runChange(async () => {
        // A lost acknowledgement can remove the host setup before its reply arrives.
        if (state.commitStatus === "complete") return;
        const details: Pick<
          WorkspaceProviderSetupCommit,
          "workspaceId" | "workspaceName" | "abbreviation" | "tileColor"
        > = {
          workspaceId: state.workspaceId.trim(),
          workspaceName: state.workspaceName.trim(),
        };
        const abbreviation = state.abbreviation.trim();
        if (abbreviation) details.abbreviation = abbreviation;
        if (state.tileColor) details.tileColor = state.tileColor;
        const outcome = await provider.commit(
          {
            ...details,
            ...prepareModelDefaultsForSave(state.modelDraft),
          },
          async (input) => {
            dispatch({ type: "commitAttempted" });
            return commitWorkspaceProviderSetup(input);
          },
        );
        if (outcome.workspace)
          dispatch({ type: "created", workspaceId: outcome.workspace.workspaceId });
        if (outcome.error || outcome.phase !== "complete")
          throw new Error(
            outcome.error ??
              "Workspace creation is incomplete. Read saved creation progress and retry.",
          );
        dispatch({ type: "committed" });
      });
      if (!completed) return;
      dispatch({ type: "progress", value: "finishing" });
      await provider.complete();
      await onSuccess?.(state.repoPath);
    } catch (cause) {
      dispatch({ type: "error", error: errorMessage(cause), stage: "models" });
    } finally {
      submitInFlight.current = false;
      dispatch({ type: "progress", value: "idle" });
      onSubmittingChange?.(false);
    }
  };

  return {
    provider,
    recoverCreation: async () => {
      if (busy || submitInFlight.current || state.commitStatus !== "attempted") return;
      try {
        const saved = await provider.recover();
        if (!saved) return;
        if (saved.progress.workspace)
          dispatch({ type: "created", workspaceId: saved.progress.workspace.workspaceId });
        dispatch({
          type: "error",
          error:
            saved.progress.error ??
            (saved.progress.registrationSaved
              ? "Workspace and settings are saved. Retry to complete creation."
              : "No workspace was created. Retry creation."),
          stage: "models",
        });
      } catch (cause) {
        dispatch({ type: "error", error: errorMessage(cause), stage: "models" });
      }
    },
    abandon: async () => {
      if (submitInFlight.current || submitting || disabled || resolvingRepo.current) return false;
      if (!(await provider.discard())) return false;
      dispatch({ type: "reset" });
      return true;
    },
    continueProvider: async () => {
      if (!busy && (provider.status?.health?.available || (await provider.check())))
        dispatch({ type: "stage", stage: "information" });
    },
    skipProvider: async () => {
      if (!busy && (await provider.skip())) dispatch({ type: "stage", stage: "information" });
    },
    stage: state.stage,
    repoPath: state.repoPath,
    workspaceName: state.workspaceName,
    workspaceId: state.workspaceId,
    abbreviation: state.abbreviation,
    tileColor: state.tileColor,
    modelDraft: state.modelDraft,
    createdWorkspaceId: state.createdWorkspaceId,
    committed: state.commitStatus === "complete",
    canRecoverCreation: state.commitStatus === "attempted",
    pickerOpen: state.pickerOpen,
    submitting,
    progress: state.progress,
    busy,
    canAbandon,
    validationError,
    error: state.errorStage === state.stage ? state.error : null,
    openPicker: () => {
      if (!busy && !state.createdWorkspaceId) dispatch({ type: "picker", open: true });
    },
    closePicker: () => {
      if (!busy) dispatch({ type: "picker", open: false });
    },
    confirmRepo,
    reviewRepo: () => {
      if (!busy && state.repoPath) dispatch({ type: "stage", stage: "provider" });
    },
    back: () => {
      if (busy || state.commitStatus === "complete") return;
      if (state.stage === "models") dispatch({ type: "stage", stage: "information" });
      else if (state.stage === "information") dispatch({ type: "stage", stage: "provider" });
      else if (state.stage === "provider" && !state.createdWorkspaceId)
        dispatch({ type: "stage", stage: "repository" });
    },
    next: () => {
      if (!busy && state.stage === "information" && !validationError)
        dispatch({ type: "stage", stage: "models" });
    },
    updateWorkspaceId: (workspaceId) => dispatch({ type: "id", workspaceId: workspaceId.trim() }),
    updateWorkspaceName: (workspaceName) =>
      dispatch({
        type: "name",
        workspaceName,
        workspaceId: state.editedId
          ? state.workspaceId
          : uniquifyWorkspaceId(proposeWorkspaceId(workspaceName), existingIds),
      }),
    updateAbbreviation: (abbreviation) => dispatch({ type: "abbreviation", abbreviation }),
    updateTileColor: (tileColor) => dispatch({ type: "tileColor", tileColor }),
    updateModelDraft: (updater) => dispatch({ type: "models", updater }),
    submit,
  };
}

const WORKSPACE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export type WorkspaceCreationStage = "repository" | "provider" | "information" | "models";

const deriveWorkspaceNameFromRepoPath = (repoPath: string): string => {
  const trimmedPath = repoPath.trim().replace(/[\\/]+$/, "");
  const segments = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1)?.trim() || repoPath.trim();
};

const proposeWorkspaceId = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";

const uniquifyWorkspaceId = (candidate: string, existingIds: Set<string>): string => {
  if (!existingIds.has(candidate)) return candidate;
  let suffix = 2;
  while (existingIds.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
};

const emptyModelDraft = (): WorkspaceModelDefaultsDraft => ({
  defaultModel: undefined,
  agentDefaults: {},
});

type State = {
  stage: WorkspaceCreationStage;
  pickerOpen: boolean;
  repoPath: string;
  workspaceName: string;
  workspaceId: string;
  abbreviation: string;
  tileColor: string | null;
  editedId: boolean;
  modelDraft: WorkspaceModelDefaultsDraft;
  createdWorkspaceId: string | null;
  commitStatus: "not_attempted" | "attempted" | "complete";
  progress: "idle" | "creating" | "saving" | "finishing";
  error: string | null;
  errorStage: WorkspaceCreationStage | null;
};

type Action =
  | { type: "reset"; pickerOpen?: boolean }
  | { type: "picker"; open: boolean }
  | { type: "repo"; repoPath: string; workspaceName: string; workspaceId: string }
  | { type: "stage"; stage: WorkspaceCreationStage; pickerOpen?: boolean }
  | { type: "name"; workspaceName: string; workspaceId: string }
  | { type: "id"; workspaceId: string }
  | { type: "abbreviation"; abbreviation: string }
  | { type: "tileColor"; tileColor: string | null }
  | {
      type: "models";
      updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft;
    }
  | { type: "created"; workspaceId: string }
  | { type: "committed" }
  | { type: "commitAttempted" }
  | { type: "progress"; value: State["progress"] }
  | { type: "error"; error: string | null; stage: WorkspaceCreationStage | null };

const initialState: State = {
  stage: "repository",
  pickerOpen: false,
  repoPath: "",
  workspaceName: "",
  workspaceId: "",
  abbreviation: "",
  tileColor: null,
  editedId: false,
  modelDraft: emptyModelDraft(),
  createdWorkspaceId: null,
  commitStatus: "not_attempted",
  progress: "idle",
  error: null,
  errorStage: null,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "reset":
      return {
        ...initialState,
        pickerOpen: action.pickerOpen ?? false,
        modelDraft: emptyModelDraft(),
      };
    case "picker":
      return { ...state, pickerOpen: action.open, error: null };
    case "repo":
      if (state.repoPath === action.repoPath) {
        return { ...state, stage: "provider", pickerOpen: false, error: null };
      }
      return {
        ...state,
        ...action,
        stage: "provider",
        pickerOpen: false,
        abbreviation: "",
        tileColor: null,
        editedId: false,
        modelDraft: emptyModelDraft(),
        commitStatus: "not_attempted",
        error: null,
      };
    case "stage":
      return { ...state, stage: action.stage, pickerOpen: action.pickerOpen ?? false, error: null };
    case "name":
      return { ...state, workspaceName: action.workspaceName, workspaceId: action.workspaceId };
    case "id":
      return { ...state, workspaceId: action.workspaceId, editedId: true };
    case "abbreviation":
      return { ...state, abbreviation: action.abbreviation };
    case "tileColor":
      return { ...state, tileColor: action.tileColor };
    case "models":
      return { ...state, modelDraft: action.updater(state.modelDraft), error: null };
    case "created":
      return { ...state, createdWorkspaceId: action.workspaceId };
    case "commitAttempted":
      return { ...state, commitStatus: "attempted" };
    case "committed":
      return { ...state, commitStatus: "complete" };
    case "progress":
      return { ...state, progress: action.value };
    case "error":
      return { ...state, error: action.error, errorStage: action.stage };
  }
};

type WorkspaceCreationFormProps = {
  workspaces: WorkspaceRecord[];
  commitWorkspaceProviderSetup: (
    input: WorkspaceProviderSetupCommit,
  ) => Promise<WorkspaceProviderSetupProgress>;
  disabled?: boolean;
  onSubmittingChange?: (submitting: boolean) => void;
  onSuccess?: (repoPath: string) => void | Promise<void>;
  resolveRepoPath?: (repoPath: string) => Promise<WorkspacePathResolution>;
  onReopenClosedWorkspace?: (workspace: WorkspaceRecord) => Promise<void>;
  runWorkspaceChange?: (change: () => Promise<void>) => Promise<boolean>;
};

export type WorkspaceCreationController = {
  provider: WorkspaceProviderSetupController;
  abandon: () => Promise<boolean>;
  continueProvider: () => Promise<void>;
  skipProvider: () => Promise<void>;
  recoverCreation: () => Promise<void>;
  stage: WorkspaceCreationStage;
  repoPath: string;
  workspaceName: string;
  workspaceId: string;
  abbreviation: string;
  tileColor: string | null;
  modelDraft: WorkspaceModelDefaultsDraft;
  createdWorkspaceId: string | null;
  committed: boolean;
  canRecoverCreation: boolean;
  pickerOpen: boolean;
  submitting: boolean;
  progress: State["progress"];
  busy: boolean;
  canAbandon: boolean;
  validationError: string | null;
  error: string | null;
  openPicker: () => void;
  closePicker: () => void;
  confirmRepo: (repoPath: string) => Promise<void>;
  reviewRepo: () => void;
  back: () => void;
  next: () => void;
  updateWorkspaceId: (workspaceId: string) => void;
  updateWorkspaceName: (workspaceName: string) => void;
  updateAbbreviation: (abbreviation: string) => void;
  updateTileColor: (tileColor: string | null) => void;
  updateModelDraft: (
    updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft,
  ) => void;
  submit: () => Promise<void>;
};
