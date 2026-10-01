import type { SidebarSessionGrouping } from "@openducktor/contracts";
import { List, ListTree } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function SessionGroupingToggle({
  grouping,
  onChange,
  disabled,
}: {
  grouping: SidebarSessionGrouping;
  onChange: (grouping: SidebarSessionGrouping) => void;
  disabled: boolean;
}): ReactElement {
  const grouped = grouping === "task";
  const label = grouped ? "Show every session" : "Group sessions by task";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-sidebar-muted-foreground hover:bg-transparent hover:text-sidebar-foreground"
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(grouped ? "none" : "task")}
          >
            <span
              className="t-icon-swap size-4"
              data-state={grouped ? "a" : "b"}
              aria-hidden="true"
            >
              <ListTree className="t-icon size-4" data-icon="a" />
              <List className="t-icon size-4" data-icon="b" />
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
