import { useMemo } from "react";
import { useWorkspaceState } from "@/state/app-state-provider";
import { RepositorySelector } from "./repository-selector";

type RepositorySwitcherProps = {
  className?: string;
  triggerClassName?: string;
};

export function RepositorySwitcher({ className, triggerClassName }: RepositorySwitcherProps = {}) {
  const { workspaces, activeRepo, selectWorkspace, isSwitchingWorkspace } = useWorkspaceState();

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.repoPath === activeRepo) ?? null,
    [activeRepo, workspaces],
  );

  if (workspaces.length === 0) {
    return null;
  }

  const selectedValue = activeWorkspace?.workspaceId ?? workspaces[0]?.workspaceId ?? "";

  return (
    <RepositorySelector
      workspaces={workspaces}
      value={selectedValue}
      disabled={isSwitchingWorkspace}
      onValueChange={(value) => {
        if (!value || value === activeWorkspace?.workspaceId) {
          return;
        }
        void selectWorkspace(value).catch(() => {
          // Error toast is emitted by workspace operations.
        });
      }}
      {...(className !== undefined ? { className } : {})}
      {...(triggerClassName !== undefined ? { triggerClassName } : {})}
    />
  );
}
