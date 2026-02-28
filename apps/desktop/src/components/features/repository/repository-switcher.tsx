import { useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { workspaceNameFromPath } from "@/lib/workspace-label";
import { useWorkspaceState } from "@/state";

type RepositorySwitcherProps = {
  className?: string;
  triggerClassName?: string;
};

export function RepositorySwitcher({ className, triggerClassName }: RepositorySwitcherProps = {}) {
  const { workspaces, activeRepo, selectWorkspace, isSwitchingWorkspace } = useWorkspaceState();

  const options = useMemo<ComboboxOption[]>(
    () =>
      workspaces.map((workspace) => ({
        value: workspace.path,
        label: workspaceNameFromPath(workspace.path),
        searchKeywords: workspace.path.split("/").filter(Boolean),
      })),
    [workspaces],
  );

  if (options.length === 0) {
    return null;
  }

  const selectedValue = activeRepo ?? options[0]?.value ?? "";

  return (
    <div className={cn("min-w-0", className)}>
      <Combobox
        value={selectedValue}
        options={options}
        disabled={isSwitchingWorkspace}
        searchPlaceholder="Search repository..."
        onValueChange={(value) => {
          if (!value || value === activeRepo) {
            return;
          }
          void selectWorkspace(value).catch(() => {
            // Error toast is emitted by workspace operations.
          });
        }}
        triggerClassName={cn(
          "h-9 w-full rounded-md border-input bg-card px-3 text-sm text-foreground",
          triggerClassName,
        )}
      />
    </div>
  );
}
