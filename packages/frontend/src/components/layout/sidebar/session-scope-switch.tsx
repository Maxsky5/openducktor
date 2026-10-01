import type { WorkspaceRecord } from "@openducktor/contracts";
import { Folder, LayoutGrid } from "lucide-react";
import type { ReactElement } from "react";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
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
        className={cn("min-w-0 text-foreground/70", compact && "px-0")}
      >
        {compact ? (
          <Folder className="size-4" aria-hidden="true" />
        ) : (
          <span className="truncate">{workspace?.workspaceName ?? "No workspace"}</span>
        )}
      </RadioGroupSegmentItem>
      <RadioGroupSegmentItem
        value="all"
        aria-label="Show sessions of all workspaces"
        title="Show sessions of all workspaces"
        className={cn("min-w-0 text-foreground/70", compact && "px-0")}
      >
        {compact ? (
          <LayoutGrid className="size-4" aria-hidden="true" />
        ) : (
          <span className="truncate">All workspaces</span>
        )}
      </RadioGroupSegmentItem>
    </RadioGroup>
  );
}
