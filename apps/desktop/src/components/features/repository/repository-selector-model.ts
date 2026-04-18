import type { WorkspaceRecord } from "@openducktor/contracts";
import type { ComboboxOption } from "@/components/ui/combobox";

export const toRepositorySelectorOptions = (
  workspaces: WorkspaceRecord[],
  errorCountByWorkspaceId: Partial<Record<string, number>> = {},
): ComboboxOption[] => {
  return workspaces.map((workspace) => {
    const repoErrorCount = errorCountByWorkspaceId[workspace.workspaceId] ?? 0;
    return {
      value: workspace.workspaceId,
      label: workspace.workspaceName,
      searchKeywords: [workspace.workspaceName, ...workspace.repoPath.split("/").filter(Boolean)],
      ...(repoErrorCount > 0
        ? {
            accentColor: "hsl(var(--destructive))",
            secondaryLabel: `${repoErrorCount} error${repoErrorCount > 1 ? "s" : ""}`,
          }
        : {}),
    };
  });
};
