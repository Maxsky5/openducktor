import { useOrchestrator } from "@/state/orchestrator-context";
import { type ReactElement, useEffect, useState } from "react";

const workspaceLabel = (path: string): string => {
  const segments = path.split("/").filter(Boolean);
  const repoName = segments.at(-1) ?? path;
  const parent =
    segments.length > 1 ? segments.slice(Math.max(0, segments.length - 3), -1).join("/") : "";
  return parent ? `${repoName}  (${parent})` : repoName;
};

export function RepositorySwitcher(): ReactElement | null {
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
    <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-2 py-1.5 md:min-w-[380px] md:w-auto">
      <select
        className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400"
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
