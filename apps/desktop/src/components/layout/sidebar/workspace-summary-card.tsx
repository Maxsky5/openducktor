import { Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import { workspaceNameFromPath } from "@/lib/workspace-label";
import { useWorkspaceState } from "@/state";

export function WorkspaceSummaryCard(): ReactElement {
  const { activeRepo } = useWorkspaceState();

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3 text-info-accent" />
        <span>Workspace</span>
      </div>
      {activeRepo ? (
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight text-foreground">
            {workspaceNameFromPath(activeRepo)}
          </p>
          <p className="break-all rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {activeRepo}
          </p>
        </div>
      ) : (
        <p className="font-mono">No repo selected</p>
      )}
    </div>
  );
}
