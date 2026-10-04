import type { WorkspaceRecord } from "@openducktor/contracts";
import { LayoutGrid } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SessionNavigationScope = "current" | "all";

/**
 * Switch the session list between the active workspace and all open workspaces.
 * Each choice takes one click or one key press in both sidebar modes.
 */
export function SessionScopeSwitch({
  scope,
  onScopeChange,
  workspace,
  compact = false,
}: {
  scope: SessionNavigationScope;
  onScopeChange: (scope: SessionNavigationScope) => void;
  workspace: Pick<WorkspaceRecord, "workspaceName"> | null;
  compact?: boolean;
}): ReactElement {
  const currentLabel = workspace
    ? `Show sessions of ${workspace.workspaceName}`
    : "No workspace is selected";
  const allLabel = "Show sessions of all workspaces";
  if (compact) {
    const all = scope === "all";
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={allLabel}
              aria-pressed={all}
              disabled={all && !workspace}
              className={cn(
                "size-8 text-sidebar-muted-foreground hover:text-sidebar-foreground",
                all && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
              )}
              onClick={() => onScopeChange(all ? "current" : "all")}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{all ? currentLabel : allLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <RadioGroup
      aria-label="Session list scope"
      orientation="horizontal"
      value={scope}
      onValueChange={(value) => {
        if (value === "current" || value === "all") onScopeChange(value);
      }}
      data-variant="segmented"
      className="grid h-8 w-full grid-cols-2 items-center gap-1 rounded-lg bg-muted p-1"
    >
      <RadioGroupSegmentItem
        value="current"
        disabled={!workspace}
        aria-label={currentLabel}
        title={currentLabel}
        className="min-w-0 text-foreground/70"
      >
        <span className="truncate">{workspace?.workspaceName ?? "No workspace"}</span>
      </RadioGroupSegmentItem>
      <RadioGroupSegmentItem
        value="all"
        aria-label={allLabel}
        title={allLabel}
        className="min-w-0 text-foreground/70"
      >
        <span className="truncate">All workspaces</span>
      </RadioGroupSegmentItem>
    </RadioGroup>
  );
}
