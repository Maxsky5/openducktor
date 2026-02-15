import { cn } from "@/lib/utils";
import { useOrchestrator } from "@/state/orchestrator-context";
import { type ReactElement, useEffect, useState } from "react";

const workspaceLabel = (path: string): string => {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
};

type RepositorySwitcherProps = {
  className?: string;
  selectClassName?: string;
};

export function RepositorySwitcher({
  className,
  selectClassName,
}: RepositorySwitcherProps = {}): ReactElement | null {
  const { workspaces, activeRepo, selectWorkspace, isSwitchingWorkspace } = useOrchestrator();
  const [selectedRepo, setSelectedRepo] = useState(activeRepo ?? "");

  useEffect(() => {
    if (activeRepo) {
      setSelectedRepo(activeRepo);
      return;
    }

    const firstWorkspace = workspaces[0];
    if (firstWorkspace && !selectedRepo) {
      setSelectedRepo(firstWorkspace.path);
    }
  }, [activeRepo, selectedRepo, workspaces]);

  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-2 py-1.5",
        className,
      )}
    >
      <select
        className={cn(
          "h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400",
          selectClassName,
        )}
        value={selectedRepo}
        disabled={isSwitchingWorkspace}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setSelectedRepo(value);
          if (value && value !== activeRepo) {
            void selectWorkspace(value).catch(() => {
              // Status/error is handled in orchestrator context.
            });
          }
        }}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.path} value={workspace.path}>
            {workspaceLabel(workspace.path)}
          </option>
        ))}
      </select>
    </div>
  );
}
