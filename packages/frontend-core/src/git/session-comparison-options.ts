import {
  type GitBranch,
  type GitTargetBranch,
  UPSTREAM_TARGET_BRANCH,
} from "@openducktor/contracts";
import { toBranchSelectorOptions } from "../lib/branch-selector-model";
import type { SelectOption } from "../lib/select-option";
import { canonicalTargetBranch, targetBranchSelectionValue } from "../lib/target-branch";

/**
 * The comparison branch choices of a task or a chat: the repository branches, the selected
 * target also when the list lacks it, and the tracked upstream when `allowUpstream` is true.
 * `checkoutBranch` is the local branch that the compared directory has checked out, such as the
 * branch of a task worktree. A comparison with it compares the branch with itself, so the choices
 * leave it out. A default target marks its option, so the user can see the repository default.
 */
export function sessionComparisonOptions(
  branches: GitBranch[],
  target: GitTargetBranch | null,
  {
    allowUpstream = false,
    defaultTarget = null,
    checkoutBranch = null,
  }: {
    allowUpstream?: boolean | undefined;
    defaultTarget?: GitTargetBranch | null;
    checkoutBranch?: string | null;
  } = {},
): SelectOption[] {
  const selection = target ? targetBranchSelectionValue(target) : "";
  const label = target ? canonicalTargetBranch(target) : selection;
  const included = selection
    ? [
        {
          value: selection,
          label: selection === UPSTREAM_TARGET_BRANCH ? "Tracked upstream" : label,
          secondaryLabel: "selected",
        },
      ]
    : [];
  if (allowUpstream && selection !== UPSTREAM_TARGET_BRANCH)
    included.push({
      value: UPSTREAM_TARGET_BRANCH,
      label: "Tracked upstream",
      secondaryLabel: "upstream",
    });
  const choices = checkoutBranch
    ? branches.filter((branch) => branch.isRemote || branch.name !== checkoutBranch)
    : branches;
  const options = toBranchSelectorOptions(choices, {
    valueFormat: "full_ref",
    includeOptions: included,
  });
  if (!defaultTarget) return options;
  const defaultValue = targetBranchSelectionValue(defaultTarget);
  return options.map((option) => (option.value === defaultValue ? markDefault(option) : option));
}

function markDefault(option: SelectOption): SelectOption {
  const description = option.description ? `${option.description}, default` : "default";
  return { ...option, description };
}
