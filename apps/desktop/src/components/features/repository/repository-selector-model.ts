import type { ComboboxOption } from "@/components/ui/combobox";
import { workspaceNameFromPath } from "@/lib/workspace-label";

export const toRepositorySelectorOptions = (
  repoPaths: string[],
  errorCountByPath: Partial<Record<string, number>> = {},
): ComboboxOption[] => {
  return repoPaths.map((repoPath) => {
    const repoErrorCount = errorCountByPath[repoPath] ?? 0;
    return {
      value: repoPath,
      label: workspaceNameFromPath(repoPath),
      searchKeywords: repoPath.split("/").filter(Boolean),
      ...(repoErrorCount > 0
        ? {
            accentColor: "hsl(var(--destructive))",
            secondaryLabel: `${repoErrorCount} error${repoErrorCount > 1 ? "s" : ""}`,
          }
        : {}),
    };
  });
};
