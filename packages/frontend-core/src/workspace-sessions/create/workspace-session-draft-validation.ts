import {
  effectiveWorkspaceSessionTargetBranch,
  type CustomAgentRole,
  type GitBranch,
  type GitTargetBranch,
  type StartupOperationContext,
  type WorkspaceSessionLaunchRequest,
  workspaceSessionAllowsTargetBranch,
  workspaceSessionBranchNameSchema,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionWorktreeInputSchema,
  type WorkspaceSessionWorktreesListResult,
} from "@openducktor/contracts";
import type { AgentModelSelection, AgentUserMessagePart } from "@openducktor/core";
import type { AgentChatComposerDraft } from "../../drafts/agent-chat-composer-draft";
import type { WorkspaceSessionDraftOptions } from "../../drafts/new-workspace-session-draft-store";
import { draftSystemSlashCommandBlockedReason } from "../../sessions/composer/system-slash-command-guard";
import {
  existingBranchError,
  INVALID_BRANCH_NAME,
  localWorktreeBranches,
  worktreeNameError,
  type WorkspaceSessionWorktreeFieldError,
} from "./workspace-session-worktree-rules";

export type DraftQueryReadState<Data> = {
  isPending: boolean;
  isError: boolean;
  errorMessage: string | null;
  data: Data | undefined;
};

export type WorkspaceSessionDraftFieldErrors = {
  connection: string | null;
  repoConfig: string | null;
  runtime: string | null;
  role: string | null;
  targetBranch: string | null;
  branches: string | null;
  worktreeName: string | null;
  worktreeBranch: string | null;
  existingWorktree: string | null;
  composer: string | null;
};

export type WorkspaceSessionDraftValidationInput = {
  workspaceId: string;
  repoPath: string;
  isConnected: boolean;
  connectionBlockedReason?: string | null;
  options: WorkspaceSessionDraftOptions;
  composer: AgentChatComposerDraft;
  repoConfig: DraftQueryReadState<{ defaultTargetBranch: GitTargetBranch }>;
  roles: DraftQueryReadState<readonly CustomAgentRole[]>;
  branches: DraftQueryReadState<readonly GitBranch[]>;
  worktrees: DraftQueryReadState<WorkspaceSessionWorktreesListResult>;
  effectiveSelection: AgentModelSelection | null;
  selectedModelAvailable: boolean;
  isModelCatalogLoading?: boolean;
  runtimeSelectionError: string | null;
  hostValidationError: WorkspaceSessionWorktreeFieldError | null;
};

export type WorkspaceSessionDraftValidation = {
  effectiveTargetBranch: GitTargetBranch | null;
  fieldErrors: WorkspaceSessionDraftFieldErrors;
  /** First actionable reason blocking submission, or null when ready to send. */
  sendBlockedReason: string | null;
  canSubmit: boolean;
  buildLaunchRequest: (input: {
    draftId: string;
    parts: AgentUserMessagePart[];
    startup?: StartupOperationContext;
  }) => WorkspaceSessionLaunchRequest | null;
};

/**
 * Validates all draft creation options, query readiness, stale restored choices, connection
 * availability, and draft-disallowed system slash commands.
 */
export function validateWorkspaceSessionDraft(
  input: WorkspaceSessionDraftValidationInput,
): WorkspaceSessionDraftValidation {
  const {
    workspaceId,
    repoPath,
    isConnected,
    connectionBlockedReason,
    options,
    composer,
    repoConfig,
    roles,
    branches,
    worktrees,
    effectiveSelection,
    selectedModelAvailable,
    isModelCatalogLoading = false,
    runtimeSelectionError,
    hostValidationError,
  } = input;

  const defaultTarget = repoConfig.data?.defaultTargetBranch ?? null;
  const effectiveTargetBranch = effectiveWorkspaceSessionTargetBranch(
    options.location,
    options.targetBranch,
    defaultTarget,
  );

  const connectionError = isConnected
    ? null
    : (connectionBlockedReason ?? "Wait for the host connection before starting a session.");

  const repoConfigError = repoConfig.isError
    ? (repoConfig.errorMessage ?? "Could not load workspace settings.")
    : null;

  let runtimeError: string | null = runtimeSelectionError;
  if (!runtimeError) {
    if (!effectiveSelection?.runtimeKind) {
      runtimeError = repoConfig.isPending ? null : "Select a runtime and model before sending.";
    } else if (!isModelCatalogLoading && !selectedModelAvailable) {
      runtimeError =
        "The selected model is no longer available for this runtime. Choose another model.";
    }
  }

  let roleError: string | null = null;
  if (roles.isError) {
    roleError = roles.errorMessage ?? "Could not load custom agent roles.";
  } else if (
    options.customAgentRoleId !== null &&
    !roles.isPending &&
    roles.data &&
    !roles.data.some((role) => role.id === options.customAgentRoleId)
  ) {
    roleError = "The selected custom role no longer exists. Choose another role or No role.";
  }

  let targetBranchError: string | null = null;
  if (
    options.targetBranch !== null &&
    !workspaceSessionAllowsTargetBranch(options.location, options.targetBranch)
  ) {
    targetBranchError = "Tracked upstream is available only for the current checkout.";
  } else if (!repoConfig.isPending && !repoConfig.isError && effectiveTargetBranch === null) {
    targetBranchError = "Select a target branch for this worktree.";
  }

  const branchesError = branches.isError
    ? (branches.errorMessage ?? "Could not load repository branches.")
    : null;

  const localBranches = localWorktreeBranches(branches.data);
  let worktreeNameErr: string | null = null;
  let worktreeBranchErr: string | null = null;
  let existingWorktreeErr: string | null = null;

  if (options.location === "local_worktree") {
    worktreeNameErr = worktreeNameError(options.worktree.name, hostValidationError);
    if (options.worktree.mode === "from_name") {
      if (hostValidationError?.field === "worktree.branchName") {
        worktreeBranchErr = hostValidationError.message;
      } else if (
        options.worktree.branchName !== null &&
        options.worktree.branchName.trim().length > 0
      ) {
        const trimmed = options.worktree.branchName.trim();
        if (!workspaceSessionBranchNameSchema.safeParse(trimmed).success) {
          worktreeBranchErr = INVALID_BRANCH_NAME;
        } else if (localBranches.some((entry) => entry.name === trimmed)) {
          worktreeBranchErr = `Branch ${trimmed} already exists. Choose another name or use Existing branch.`;
        }
      }
    } else {
      if (branchesError) {
        worktreeBranchErr = branchesError;
      } else if (!options.worktree.branchName.trim()) {
        worktreeBranchErr = "Select a local branch for the new worktree.";
      } else if (
        !branches.isPending &&
        !localBranches.some((entry) => entry.name === options.worktree.branchName)
      ) {
        worktreeBranchErr = `Branch ${options.worktree.branchName} is no longer available. Select another local branch.`;
      } else {
        worktreeBranchErr = existingBranchError(
          options.worktree,
          localBranches,
          hostValidationError,
        );
      }
      if (!worktreeNameErr && options.worktree.name.trim().length === 0) {
        worktreeNameErr = "Enter a worktree directory name.";
      }
    }
  } else if (options.location === "existing_worktree") {
    if (worktrees.isError) {
      existingWorktreeErr = worktrees.errorMessage ?? "Could not load existing worktrees.";
    } else if (!options.existingWorktreeDirectory) {
      existingWorktreeErr = "Select an existing worktree.";
    } else if (
      !worktrees.isPending &&
      worktrees.data &&
      !worktrees.data.worktrees.some(
        (entry) => entry.workingDirectory === options.existingWorktreeDirectory,
      )
    ) {
      existingWorktreeErr =
        "The selected worktree is no longer registered. Choose another worktree or location.";
    }
  }

  const composerError = draftSystemSlashCommandBlockedReason(composer, false);

  const fieldErrors: WorkspaceSessionDraftFieldErrors = {
    connection: connectionError,
    repoConfig: repoConfigError,
    runtime: runtimeError,
    role: roleError,
    targetBranch: targetBranchError,
    branches: branchesError,
    worktreeName: worktreeNameErr,
    worktreeBranch: worktreeBranchErr,
    existingWorktree: existingWorktreeErr,
    composer: composerError,
  };

  let pendingReason: string | null = null;
  if (repoConfig.isPending) {
    pendingReason = "Loading workspace settings...";
  } else if (isModelCatalogLoading) {
    pendingReason = "Loading models...";
  } else if (roles.isPending) {
    pendingReason = "Loading custom agent roles...";
  } else if (
    options.location === "local_worktree" &&
    options.worktree.mode === "from_branch" &&
    branches.isPending
  ) {
    pendingReason = "Loading repository branches...";
  } else if (options.location === "existing_worktree" && worktrees.isPending) {
    pendingReason = "Loading existing worktrees...";
  }

  const sendBlockedReason =
    connectionError ??
    composerError ??
    repoConfigError ??
    runtimeError ??
    roleError ??
    targetBranchError ??
    worktreeBranchErr ??
    worktreeNameErr ??
    existingWorktreeErr ??
    pendingReason;

  const canSubmit = sendBlockedReason === null;

  const buildLaunchRequest: WorkspaceSessionDraftValidation["buildLaunchRequest"] = ({
    draftId,
    parts,
    startup,
  }) => {
    if (!canSubmit || !effectiveSelection?.runtimeKind || !effectiveTargetBranch) {
      return null;
    }
    const base = {
      workspaceId,
      repoPath,
      draftId,
      runtimeKind: effectiveSelection.runtimeKind,
      selectedModel: { ...effectiveSelection, runtimeKind: effectiveSelection.runtimeKind },
      customAgentRoleId: options.customAgentRoleId,
      targetBranch: effectiveTargetBranch,
      parts,
    };
    const withStartup = startup ? { ...base, startup } : base;
    if (options.location === "local_repo_root") {
      return { ...withStartup, location: "local_repo_root" };
    }
    if (options.location === "existing_worktree") {
      if (!options.existingWorktreeDirectory) return null;
      return {
        ...withStartup,
        location: "existing_worktree",
        existingWorktree: { workingDirectory: options.existingWorktreeDirectory },
      };
    }
    const normalizedWorktree =
      options.worktree.mode === "from_name" &&
      options.worktree.branchName !== null &&
      options.worktree.branchName.trim() === ""
        ? { ...options.worktree, branchName: null }
        : options.worktree;
    const parsedWorktree = workspaceSessionWorktreeInputSchema.safeParse(normalizedWorktree);
    if (!parsedWorktree.success) return null;
    return {
      ...withStartup,
      location: "local_worktree",
      worktree: parsedWorktree.data,
    };
  };

  return {
    effectiveTargetBranch,
    fieldErrors,
    sendBlockedReason,
    canSubmit,
    buildLaunchRequest,
  };
}

export function hasActiveNewWorktreeError(
  worktree: WorkspaceSessionWorktreeInput,
  fieldErrors: WorkspaceSessionDraftFieldErrors,
): string | null {
  if (worktree.mode === "from_name") {
    return fieldErrors.worktreeBranch ?? fieldErrors.worktreeName;
  }
  if (worktree.branchName.trim().length > 0 && fieldErrors.worktreeBranch) {
    return fieldErrors.worktreeBranch;
  }
  if (worktree.name.trim().length > 0 && fieldErrors.worktreeName) {
    return fieldErrors.worktreeName;
  }
  return null;
}
