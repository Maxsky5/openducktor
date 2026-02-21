import { workspaceNameFromPath } from "@/lib/workspace-label";
import { useWorkspaceState } from "@/state";
import { Sparkles } from "lucide-react";
import type { ReactElement } from "react";

export function WorkspaceSummaryCard(): ReactElement {
  const { activeRepo } = useWorkspaceState();

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3 text-sky-500" />
        <span>Workspace</span>
      </div>
      {activeRepo ? (
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight text-slate-800">
            {workspaceNameFromPath(activeRepo)}
          </p>
          <p className="break-all rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] leading-relaxed text-slate-600">
            {activeRepo}
          </p>
        </div>
      ) : (
        <p className="font-mono">No repo selected</p>
      )}
    </div>
  );
}
