import { type GitTargetBranch, UPSTREAM_TARGET_BRANCH } from "@openducktor/contracts";

export const INVALID_TASK_TARGET_BRANCH_LABEL = "Invalid task target branch";

export const normalizeTargetBranch = (value: GitTargetBranch): GitTargetBranch => {
  const branch = value.branch.trim();
  const remote = value.remote?.trim();
  if (branch === UPSTREAM_TARGET_BRANCH) {
    return {
      branch,
    };
  }

  let normalizedBranch = branch;
  let normalizedRemote = remote;
  if (normalizedBranch.startsWith("refs/heads/")) {
    normalizedBranch = normalizedBranch.slice("refs/heads/".length);
  } else if (normalizedBranch.startsWith("refs/remotes/")) {
    const remoteRef = normalizedBranch.slice("refs/remotes/".length);
    const slashIndex = remoteRef.indexOf("/");
    if (slashIndex > 0) {
      normalizedRemote ??= remoteRef.slice(0, slashIndex);
      normalizedBranch = remoteRef.slice(slashIndex + 1);
    }
  }

  if (normalizedRemote && normalizedBranch.startsWith(`${normalizedRemote}/`)) {
    normalizedBranch = normalizedBranch.slice(normalizedRemote.length + 1);
  }

  const targetBranch: GitTargetBranch = { branch: normalizedBranch };
  if (normalizedRemote) {
    targetBranch.remote = normalizedRemote;
  }
  return targetBranch;
};

/** The target branch of the task, else the default of the workspace. Null until either loads. */
export const effectiveTaskTargetBranch = (
  taskTargetBranch: GitTargetBranch | null | undefined,
  defaultTargetBranch: GitTargetBranch | null | undefined,
): GitTargetBranch | null => {
  const targetBranch = taskTargetBranch ?? defaultTargetBranch;
  return targetBranch ? normalizeTargetBranch(targetBranch) : null;
};

export const taskTargetBranchValidationError = (
  value: string | null | undefined,
): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** The target branch that a task compares with, and why its saved target is invalid. */
export type TaskTargetBranchState = {
  effectiveTargetBranch: GitTargetBranch | null;
  validationError: string | null;
};

export const resolveTaskTargetBranchState = ({
  taskTargetBranch,
  taskTargetBranchError,
  defaultTargetBranch,
}: {
  taskTargetBranch: GitTargetBranch | null | undefined;
  taskTargetBranchError: string | null | undefined;
  defaultTargetBranch: GitTargetBranch | null | undefined;
}): TaskTargetBranchState => ({
  effectiveTargetBranch: effectiveTaskTargetBranch(taskTargetBranch, defaultTargetBranch),
  validationError: taskTargetBranchValidationError(taskTargetBranchError),
});

export const canonicalTargetBranch = (value: GitTargetBranch): string => {
  const normalized = normalizeTargetBranch(value);
  if (normalized.branch === UPSTREAM_TARGET_BRANCH) {
    return normalized.branch;
  }
  return normalized.remote ? `${normalized.remote}/${normalized.branch}` : normalized.branch;
};

export const checkoutTargetBranch = (value: GitTargetBranch): string =>
  normalizeTargetBranch(value).branch;

export const targetBranchSelectionValue = (value: GitTargetBranch): string => {
  const normalized = normalizeTargetBranch(value);
  if (normalized.branch === UPSTREAM_TARGET_BRANCH) {
    return normalized.branch;
  }

  return normalized.remote
    ? `refs/remotes/${normalized.remote}/${normalized.branch}`
    : `refs/heads/${normalized.branch}`;
};

/** The choice value of a target branch, or empty while no target is loaded. */
export const targetBranchSelectionValueOrEmpty = (value: GitTargetBranch | null): string =>
  value ? targetBranchSelectionValue(value) : "";

export const targetBranchRemote = (value: GitTargetBranch): string | null => {
  const normalized = normalizeTargetBranch(value);
  if (normalized.branch === UPSTREAM_TARGET_BRANCH) {
    return null;
  }
  return normalized.remote ?? null;
};

export const targetBranchFromSelection = (value: string): GitTargetBranch => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Choose a target branch.");
  }
  if (trimmed === UPSTREAM_TARGET_BRANCH) {
    return {
      branch: trimmed,
    };
  }
  if (trimmed.startsWith("refs/remotes/")) {
    const remoteRef = trimmed.slice("refs/remotes/".length);
    const slashIndex = remoteRef.indexOf("/");
    if (slashIndex > 0) {
      return {
        remote: remoteRef.slice(0, slashIndex),
        branch: remoteRef.slice(slashIndex + 1),
      };
    }
    throw new Error(`Invalid remote-tracking branch selection: ${value}`);
  }
  if (trimmed.startsWith("refs/heads/")) {
    return {
      branch: trimmed.slice("refs/heads/".length),
    };
  }
  return {
    branch: trimmed,
  };
};
