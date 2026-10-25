import {
  type GitBranch,
  type HostInvokeFailure,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionBranchNameSchema,
  workspaceSessionWorktreeNameSchema,
} from "@openducktor/contracts";

/** A worktree field error that the host reported for a create request. */
export type WorkspaceSessionWorktreeFieldError = {
  field: Extract<HostInvokeFailure, { kind: "workspace_session_validation" }>["field"];
  message: string;
};

export const INITIAL_WORKSPACE_SESSION_WORKTREE: WorkspaceSessionWorktreeInput = Object.freeze({
  mode: "from_name",
  name: "",
  branchName: null,
});

export const WORKTREE_NAME_RULE =
  "Use letters, numbers, hyphens, or underscores, starting with a letter or number. Names must be at most 80 characters.";

export const WORKTREE_NAME_MAX_LENGTH = 80;

/** Switches between a new branch and an existing branch. The worktree name stays. */
export const changeWorktreeMode = (
  value: WorkspaceSessionWorktreeInput,
  mode: WorkspaceSessionWorktreeInput["mode"],
): WorkspaceSessionWorktreeInput =>
  mode === "from_branch"
    ? { mode, name: value.name, branchName: "" }
    : { mode, name: value.name, branchName: null };

/** The directory name that the host creates for the worktree, or null when the name is invalid. */
export const worktreeDirectoryName = (name: string): string | null => {
  const parsed = workspaceSessionWorktreeNameSchema.safeParse(name);
  return parsed.success ? parsed.data : null;
};

/** The error of the worktree name field: the host error first, then the local name rule. */
export const worktreeNameError = (
  name: string,
  error: WorkspaceSessionWorktreeFieldError | null,
): string | null => {
  if (error?.field === "worktree.name") return error.message;
  return name.length > 0 && worktreeDirectoryName(name) === null ? WORKTREE_NAME_RULE : null;
};

/** The branches that a chat can use directly: local branches only. */
export const localWorktreeBranches = (branches: readonly GitBranch[] | undefined): GitBranch[] =>
  (branches ?? []).filter((branch) => !branch.isRemote);

/** Why a local branch cannot back a new chat worktree, or null when it can. */
export const existingBranchUnavailableReason = (branch: GitBranch): string | null =>
  branch.worktreePath ? `Already checked out at ${branch.worktreePath}` : null;

/** Picks an existing branch. A worktree without a name takes a safe name from the branch. */
export const selectExistingBranch = (
  value: WorkspaceSessionWorktreeInput,
  branchName: string,
): WorkspaceSessionWorktreeInput => ({
  mode: "from_branch",
  name:
    value.name ||
    branchName
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, WORKTREE_NAME_MAX_LENGTH),
  branchName,
});

/** The error of the existing branch field: the host error first, then a checked-out branch. */
export const existingBranchError = (
  value: WorkspaceSessionWorktreeInput,
  branches: readonly GitBranch[],
  error: WorkspaceSessionWorktreeFieldError | null,
): string | null => {
  if (error?.field === "worktree.branchName") return error.message;
  if (value.mode !== "from_branch") return null;
  const checkedOutAt = branches.find((branch) => branch.name === value.branchName)?.worktreePath;
  return checkedOutAt
    ? `This branch is already checked out at ${checkedOutAt}. Choose another branch or use Current checkout.`
    : null;
};

/** The branch facts of a worktree on a new branch. */
export type NewWorktreeBranchState = { branchError: boolean; defaultBranch: string };

/**
 * The branch of a worktree on a new branch: the typed name, else the repository branch prefix and
 * the worktree name. `branchError` is true when a typed name is not a valid Git branch name.
 */
export const newWorktreeBranchState = (
  value: WorkspaceSessionWorktreeInput,
  branchPrefix: string | undefined,
): NewWorktreeBranchState => {
  const directory = worktreeDirectoryName(value.name);
  const branchError =
    value.branchName !== null &&
    value.branchName.length > 0 &&
    !workspaceSessionBranchNameSchema.safeParse(value.branchName).success;
  const defaultBranch =
    branchPrefix !== undefined && directory !== null ? `${branchPrefix}/${directory}` : "";
  return { branchError, defaultBranch };
};

export const INVALID_BRANCH_NAME = "Enter a valid Git branch name.";
