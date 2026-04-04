import { useMemo } from "react";
import { useWorkspaceState } from "@/state/app-state-provider";
import { RepositorySelector } from "./repository-selector";

type RepositorySwitcherProps = {
  className?: string;
  triggerClassName?: string;
};

export function RepositorySwitcher({ className, triggerClassName }: RepositorySwitcherProps = {}) {
  const { workspaces, activeRepo, selectWorkspace, isSwitchingWorkspace } = useWorkspaceState();

  const repoPaths = useMemo(() => workspaces.map((workspace) => workspace.path), [workspaces]);

  if (repoPaths.length === 0) {
    return null;
  }

  const selectedValue = activeRepo ?? repoPaths[0] ?? "";

  return (
    <RepositorySelector
      repoPaths={repoPaths}
      value={selectedValue}
      disabled={isSwitchingWorkspace}
      onValueChange={(value) => {
        if (!value || value === activeRepo) {
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
