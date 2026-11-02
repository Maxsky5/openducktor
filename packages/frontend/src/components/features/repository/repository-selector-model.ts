import type { WorkspaceRecord } from "@openducktor/contracts";
import type { ComboboxOption } from "@/components/ui/combobox";

export type RepositorySelectorWorkspace = Pick<
  WorkspaceRecord,
  "workspaceId" | "workspaceName" | "repoPath"
>;

export const toRepositorySelectorOptions = (
  workspaces: RepositorySelectorWorkspace[],
  errorCountByWorkspaceId: Partial<Record<string, number>> = {},
): ComboboxOption[] => {
  return workspaces.map((workspace) => {
    const repoErrorCount = errorCountByWorkspaceId[workspace.workspaceId] ?? 0;
    const option: ComboboxOption = {
      value: workspace.workspaceId,
      label: workspace.workspaceName,
      searchKeywords: [workspace.workspaceName, ...workspace.repoPath.split("/").filter(Boolean)],
    };
    if (repoErrorCount > 0) {
      option.accentColor = "hsl(var(--destructive))";
      option.secondaryLabel = `${repoErrorCount} error${repoErrorCount > 1 ? "s" : ""}`;
    }
    return option;
  });
};
