import type { GitBranch } from "@openducktor/contracts";
import type { SelectOption } from "./select-option";

const branchSourceLabel = (branch: GitBranch): string => {
  if (!branch.isRemote) {
    return "local";
  }

  const [remoteName] = branch.name.split("/");
  return remoteName || "remote";
};

const branchOptionValue = (branch: GitBranch, valueFormat: "name" | "full_ref"): string => {
  if (valueFormat === "name") {
    return branch.name;
  }
  return branch.isRemote ? `refs/remotes/${branch.name}` : `refs/heads/${branch.name}`;
};

type BranchSelectorOptionsArgs = {
  includeBranchNames?: string[];
  includeOptions?: SelectOption[];
  valueFormat?: "name" | "full_ref";
};

export const toBranchSelectorOptions = (
  branches: GitBranch[],
  args: BranchSelectorOptionsArgs = {},
): SelectOption[] => {
  const { includeBranchNames = [], includeOptions = [], valueFormat = "name" } = args;
  const options: SelectOption[] = branches.map((branch) => {
    const option: SelectOption = {
      value: branchOptionValue(branch, valueFormat),
      label: branch.name,
      secondaryLabel: branchSourceLabel(branch),
      searchKeywords: branch.name.split("/").filter(Boolean),
    };
    if (branch.isCurrent) {
      option.description = "current";
    }
    return option;
  });

  const existingValues = new Set(options.map((option) => option.value));
  for (const option of includeOptions) {
    const trimmedValue = option.value.trim();
    if (trimmedValue.length === 0 || existingValues.has(trimmedValue)) {
      continue;
    }
    options.push({
      ...option,
      value: trimmedValue,
    });
    existingValues.add(trimmedValue);
  }
  for (const branchName of includeBranchNames) {
    const trimmed = branchName.trim();
    if (trimmed.length === 0 || existingValues.has(trimmed)) {
      continue;
    }

    options.push({
      value: trimmed,
      label: trimmed,
      secondaryLabel: "configured",
      searchKeywords: trimmed.split("/").filter(Boolean),
    });
    existingValues.add(trimmed);
  }

  return options;
};
