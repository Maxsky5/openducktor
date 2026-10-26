import {
  type GitBranch,
  type GitTargetBranch,
  UPSTREAM_TARGET_BRANCH,
} from "@openducktor/contracts";
import { toBranchSelectorOptions } from "../../lib/branch-selector-model";
import type { SelectOption } from "../../lib/select-option";
import { canonicalTargetBranch, targetBranchSelectionValue } from "../../lib/target-branch";

/** The target branch choices of a session start. */
export type SessionStartTargetBranchChoices = {
  options: SelectOption[];
  /** The choice value of a configured target that the repository does not have, or null. */
  missingValue: string | null;
  /** Why the start cannot use the configured target, or null. */
  missingMessage: string | null;
};

/**
 * The choices are the branches of the repository. The configured target of the task, or the
 * repository default, is a choice only when the repository has it, because the host refuses a
 * missing target when it creates the task worktree. An empty list is not loaded yet, so the
 * configured target is then the only choice. `@{upstream}` names no branch, so it stays a choice.
 */
export const resolveSessionStartTargetBranchChoices = (
  branches: GitBranch[],
  configured: GitTargetBranch,
): SessionStartTargetBranchChoices => {
  const value = targetBranchSelectionValue(configured);
  const label = canonicalTargetBranch(configured);
  const branchOptions = toBranchSelectorOptions(branches, { valueFormat: "full_ref" });
  const missing =
    branches.length > 0 &&
    value !== UPSTREAM_TARGET_BRANCH &&
    !branchOptions.some((option) => option.value === value);
  if (missing) {
    return {
      options: branchOptions,
      missingValue: value,
      missingMessage: `Target branch ${label} does not exist in this repository. Choose another target branch.`,
    };
  }
  return {
    options: toBranchSelectorOptions(branches, {
      valueFormat: "full_ref",
      includeOptions: [
        {
          value,
          label,
          secondaryLabel: "configured",
          searchKeywords: label.split("/").filter(Boolean),
        },
      ],
    }),
    missingValue: null,
    missingMessage: null,
  };
};
