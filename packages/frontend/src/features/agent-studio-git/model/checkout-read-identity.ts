import type { GitCurrentBranch } from "@openducktor/contracts";

/**
 * The checkout part of a Git read key: the branch name, or one value for any detached HEAD.
 * A commit or a rebase step keeps it, so the panel keeps its data while the reads run again.
 * Another branch gets reads of its own.
 */
export const checkoutReadIdentity = (
  branch: GitCurrentBranch | null | undefined,
): string | null => {
  if (!branch) return null;
  if (branch.detached) return "detached";
  return branch.name != null ? `branch:${branch.name}` : null;
};
