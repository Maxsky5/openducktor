import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { workspaceNameFromPath } from "@/lib/workspace-label";
import { useOrchestrator } from "@/state";
import { useMemo } from "react";

type RepositorySwitcherProps = {
  className?: string;
  triggerClassName?: string;
};

export function RepositorySwitcher({ className, triggerClassName }: RepositorySwitcherProps = {}) {
  const { workspaces, activeRepo, selectWorkspace, isSwitchingWorkspace } = useOrchestrator();

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
    <div className={cn("w-full", className)}>
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
            // Status/error is handled in orchestrator context.
          });
        }}
        triggerClassName={cn(
          "h-9 w-full rounded-md border-slate-300 bg-white px-3 text-sm text-slate-700",
          triggerClassName,
        )}
      />
    </div>
  );
}
