import type { GitBranch } from "@openducktor/contracts";
import type { ComboboxOption } from "@/components/ui/combobox";

const branchSourceLabel = (branch: GitBranch): string => {
  if (!branch.isRemote) {
    return "local";
  }

  const [remoteName] = branch.name.split("/");
  return remoteName || "remote";
};

type BranchSelectorOptionsArgs = {
  includeBranchNames?: string[];
};

export const toBranchSelectorOptions = (
  branches: GitBranch[],
  args: BranchSelectorOptionsArgs = {},
): ComboboxOption[] => {
  const { includeBranchNames = [] } = args;
  const options: ComboboxOption[] = branches.map((branch) => ({
    value: branch.name,
    label: branch.name,
    secondaryLabel: branchSourceLabel(branch),
    ...(branch.isCurrent ? { description: "current" } : {}),
    searchKeywords: branch.name.split("/").filter(Boolean),
  }));

  const existingValues = new Set(options.map((option) => option.value));
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
