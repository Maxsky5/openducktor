import type { GitTargetBranch } from "@openducktor/contracts";

export const UPSTREAM_TARGET_BRANCH = "@{upstream}";

export const DEFAULT_TARGET_BRANCH: GitTargetBranch = {
  remote: "origin",
  branch: "main",
};

export const normalizeTargetBranch = (
  value: GitTargetBranch | null | undefined,
): GitTargetBranch => {
  if (!value) {
    return DEFAULT_TARGET_BRANCH;
  }

  const branch = value.branch.trim();
  if (!branch) {
    return DEFAULT_TARGET_BRANCH;
  }
  const remote = value.remote?.trim();
  if (branch === UPSTREAM_TARGET_BRANCH) {
    return {
      branch,
    };
  }

  return {
    ...(remote ? { remote } : {}),
    branch,
  };
};

export const canonicalTargetBranch = (
  value: GitTargetBranch | null | undefined,
): string => {
  const normalized = normalizeTargetBranch(value);
  if (normalized.branch === UPSTREAM_TARGET_BRANCH) {
    return normalized.branch;
  }
  return normalized.remote ? `${normalized.remote}/${normalized.branch}` : normalized.branch;
};

export const checkoutTargetBranch = (
  value: GitTargetBranch | null | undefined,
): string => normalizeTargetBranch(value).branch;

export const targetBranchRemote = (
  value: GitTargetBranch | null | undefined,
): string | null => {
  const normalized = normalizeTargetBranch(value);
  if (normalized.branch === UPSTREAM_TARGET_BRANCH) {
    return null;
  }
  return normalized.remote ?? null;
};

export const targetBranchFromSelection = (value: string): GitTargetBranch => {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_TARGET_BRANCH;
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
