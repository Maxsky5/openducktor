import {
  type GitBranch,
  type GitTargetBranch,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionWorktreeInput,
} from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { RuntimeModelCatalogResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import {
  NO_CUSTOM_AGENT_ROLE,
  type WorkspaceSessionCreateLocation,
} from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import {
  existingBranchError,
  INVALID_BRANCH_NAME,
  localWorktreeBranches,
  newWorktreeBranchState,
  type WorkspaceSessionWorktreeFieldError,
  worktreeDirectoryName,
  worktreeNameError,
} from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";

/** The state of the model of a new chat. */
export type NewChatModelState =
  | { kind: "loading" }
  | { kind: "ready" }
  /** The repository has no Default Model and the user chose no model. */
  | { kind: "no_default" }
  /** The repository settings, which hold the Default Model, did not load. */
  | { kind: "settings_failed"; message: string }
  /** The selected model is not in the catalog of its runtime. */
  | { kind: "not_in_catalog"; modelLabel: string; runtimeLabel: string }
  | { kind: "catalog_failed"; message: string }
  /**
   * The runtime of the selected model is not available on the host. The reason says why the host
   * cannot use it, such as a runtime that failed to start.
   */
  | { kind: "runtime_unavailable"; runtimeLabel: string; reason: string | null };

export type NewChatModelStateInput = {
  /** The model that the user chose, or the Default Model checked against its catalog. */
  selection: AgentModelSelection | null;
  /** The repository Default Model, as the settings store it. */
  defaultSelection: AgentModelSelection | null;
  /** The read of the repository settings, which hold the Default Model. */
  repoSettings: { pending: boolean; error: string | null };
  /** The runtime of the selection, else of the Default Model. */
  runtimeKind: RuntimeKind | null;
  /** The runtimes that a new chat can use. */
  runtimeKinds: readonly RuntimeKind[];
  /** The model catalog read of `runtimeKind`. */
  resource: Pick<
    RuntimeModelCatalogResource,
    "catalog" | "isLoading" | "error" | "unavailableReason"
  > | null;
  /** True when the catalog has the selected model. */
  selectedModelFound: boolean;
};

/** The state of the model of a new chat, which decides if Create can send the chat. */
export const newChatModelState = ({
  selection,
  defaultSelection,
  repoSettings,
  runtimeKind,
  runtimeKinds,
  resource,
  selectedModelFound,
}: NewChatModelStateInput): NewChatModelState => {
  if (!selection && repoSettings.pending) return { kind: "loading" };
  if (!selection && repoSettings.error) {
    return { kind: "settings_failed", message: repoSettings.error };
  }
  if (!selection && !defaultSelection) return { kind: "no_default" };
  const runtimeLabel = runtimeKind ? RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].label : "runtime";
  if (runtimeKind !== null && !runtimeKinds.includes(runtimeKind)) {
    return { kind: "runtime_unavailable", runtimeLabel, reason: null };
  }
  if (!resource || resource.isLoading) return { kind: "loading" };
  // A runtime that is not ready has no catalog read, so its reason replaces the catalog check.
  if (!resource.catalog && resource.unavailableReason) {
    return { kind: "runtime_unavailable", runtimeLabel, reason: resource.unavailableReason };
  }
  if (resource.error && !resource.catalog) {
    return { kind: "catalog_failed", message: resource.error };
  }
  if (selectedModelFound) return { kind: "ready" };
  const missing = selection ?? defaultSelection;
  return {
    kind: "not_in_catalog",
    modelLabel: missing ? missing.modelId : "The Default Model",
    runtimeLabel,
  };
};

export type NewChatForm = {
  workspaceId: string;
  name: string;
  roleId: string;
  location: WorkspaceSessionCreateLocation;
  worktree: WorkspaceSessionWorktreeInput;
  /** The target of the chat: the pick, or the repository default that the location can use. */
  targetBranch: GitTargetBranch | null;
  /** True while the branches or the repository default target still load. */
  targetPending: boolean;
  selection: AgentModelSelection | null;
  model: NewChatModelState;
  rolesReady: boolean;
  /** The branches of the repository when the list loaded, else null. */
  branches: readonly GitBranch[] | null;
  /** The branch prefix of the repository, when its config loaded. */
  branchPrefix: string | undefined;
  /** A worktree field error that the host reported for the last create request. */
  hostError: WorkspaceSessionWorktreeFieldError | null;
  /** The create request of the shared form, which its submit sends. Null while it is not valid. */
  input: WorkspaceSessionCreateInput | null;
};

type NewChatFieldErrors = {
  name: string | null;
  model: string | null;
  worktreeName: string | null;
  branch: string | null;
};

/**
 * True when the user filled the form: a name, a Custom Agent Role, a worktree, or another model
 * than the Default Model. Close, Back, and the swipe ask before they drop such a form.
 */
export const newChatFormEdited = ({
  name,
  roleId,
  location,
  modelChanged,
}: Pick<NewChatForm, "name" | "roleId" | "location"> & { modelChanged: boolean }): boolean =>
  name.trim().length > 0 ||
  roleId !== NO_CUSTOM_AGENT_ROLE ||
  location !== "local_repo_root" ||
  modelChanged;

export type NewChatRequest = {
  /** The create request, or null while the form cannot create a chat. */
  input: WorkspaceSessionCreateInput | null;
  fieldErrors: NewChatFieldErrors;
  /** Why Create is not available yet, for the hint next to the button. Null when it is. */
  blockedReason: string | null;
  /** The worktree directory name and branch that the host creates, for the location summary. */
  worktreeSummary: { directory: string | null; branch: string | null };
};

const modelError = (model: NewChatModelState): string | null => {
  switch (model.kind) {
    case "no_default":
      return "This repository has no Default Model. Choose a model, or set a Default Model in the repository settings on the host.";
    case "settings_failed":
      return `The repository settings did not load, so the Default Model is unknown. ${model.message} Choose a model, or close and open New Chat again.`;
    case "not_in_catalog":
      return `${model.modelLabel} is not in the ${model.runtimeLabel} model catalog. Choose another model.`;
    case "catalog_failed":
      return `The model catalog could not load. ${model.message}`;
    case "runtime_unavailable":
      return model.reason
        ? `${model.reason} Or choose a model of another runtime.`
        : `The ${model.runtimeLabel} runtime is not available on the host. Choose a model of another runtime.`;
    default:
      return null;
  }
};

const nameError = (name: string): string | null =>
  name.length > WORKSPACE_SESSION_MANUAL_TITLE_LIMIT
    ? `Use at most ${WORKSPACE_SESSION_MANUAL_TITLE_LIMIT} characters.`
    : null;

const branchFieldError = (
  form: NewChatForm,
  localBranches: readonly GitBranch[],
): string | null => {
  if (form.location !== "local_worktree") return null;
  if (form.worktree.mode === "from_branch") {
    return existingBranchError(form.worktree, localBranches, form.hostError);
  }
  if (form.hostError?.field === "worktree.branchName") return form.hostError.message;
  return newWorktreeBranchState(form.worktree, form.branchPrefix).branchError
    ? INVALID_BRANCH_NAME
    : null;
};

const firstBlockedReason = (form: NewChatForm, errors: NewChatFieldErrors): string => {
  const fieldError = errors.name ?? errors.model ?? errors.worktreeName ?? errors.branch;
  if (fieldError) return "Fix the fields above to create the chat.";
  if (form.model.kind === "loading") return "Loading the model catalog.";
  if (!form.rolesReady) return "Loading the custom roles.";
  if (!form.targetBranch)
    return form.targetPending ? "Loading the target branch." : "Choose a target branch.";
  if (form.location === "local_worktree") {
    if (form.worktree.name.trim().length === 0) return "Enter a worktree name.";
    if (form.worktree.mode === "from_branch") {
      if (form.branches === null) return "Loading the branches.";
      if (!form.worktree.branchName) return "Choose a local branch.";
    }
  }
  return "Complete the form to create the chat.";
};

/**
 * Builds the create request of the New chat sheet with the shared request rules, plus the field
 * errors and the reason that Create waits, so each problem shows next to its field.
 */
export const buildNewChatRequest = (form: NewChatForm): NewChatRequest => {
  const localBranches = localWorktreeBranches(form.branches ?? undefined);
  const fieldErrors: NewChatFieldErrors = {
    name: nameError(form.name),
    model: modelError(form.model),
    worktreeName:
      form.location === "local_worktree"
        ? worktreeNameError(form.worktree.name, form.hostError)
        : null,
    branch: branchFieldError(form, localBranches),
  };
  // Create sends the request of the shared form, so it waits for the same rules.
  const input = fieldErrors.name === null ? form.input : null;
  const directory =
    form.location === "local_worktree" ? worktreeDirectoryName(form.worktree.name) : null;
  let branch: string | null = null;
  if (form.location === "local_worktree") {
    branch =
      form.worktree.mode === "from_branch"
        ? form.worktree.branchName || null
        : form.worktree.branchName ||
          newWorktreeBranchState(form.worktree, form.branchPrefix).defaultBranch ||
          null;
  }
  return {
    input,
    fieldErrors,
    blockedReason: input ? null : firstBlockedReason(form, fieldErrors),
    worktreeSummary: { directory, branch },
  };
};
