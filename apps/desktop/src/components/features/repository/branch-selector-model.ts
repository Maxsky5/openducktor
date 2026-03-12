import type { GitBranch } from "@openducktor/contracts";
import type { ComboboxOption } from "@/components/ui/combobox";

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
  includeOptions?: ComboboxOption[];
  valueFormat?: "name" | "full_ref";
};

export const toBranchSelectorOptions = (
  branches: GitBranch[],
  args: BranchSelectorOptionsArgs = {},
): ComboboxOption[] => {
  const { includeBranchNames = [], includeOptions = [], valueFormat = "name" } = args;
  const options: ComboboxOption[] = branches.map((branch) => ({
    value: branchOptionValue(branch, valueFormat),
    label: branch.name,
    secondaryLabel: branchSourceLabel(branch),
    ...(branch.isCurrent ? { description: "current" } : {}),
    searchKeywords: branch.name.split("/").filter(Boolean),
  }));

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
