import {
  type LucideIcon,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionPanelsModel } from "@/features/session-panels";

type SessionViewControlsProps = {
  bottom: SessionPanelsModel["bottomToggle"];
  right: SessionPanelsModel["rightToggle"];
};

/** The session top bar toggles for the bottom panel and the right panel. */
export function SessionViewControls({ bottom, right }: SessionViewControlsProps): ReactElement {
  return (
    <TooltipProvider>
      <div role="group" aria-label="Session views" className="flex shrink-0 items-center gap-2">
        <PanelToggleButton
          label={bottom.isOpen ? "Hide bottom panel" : "Show bottom panel"}
          icon={bottom.isOpen ? PanelBottomClose : PanelBottomOpen}
          isOpen={bottom.isOpen}
          disabled={!bottom.isAvailable}
          onToggle={bottom.onToggle}
        />
        {right ? (
          <PanelToggleButton
            label={right.isOpen ? "Hide right panel" : "Show right panel"}
            icon={right.isOpen ? PanelRightClose : PanelRightOpen}
            isOpen={right.isOpen}
            disabled={false}
            onToggle={right.onToggle}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function PanelToggleButton({
  label,
  icon: Icon,
  isOpen,
  disabled,
  onToggle,
}: {
  label: string;
  icon: LucideIcon;
  isOpen: boolean;
  disabled: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:text-foreground"
            aria-label={label}
            aria-pressed={isOpen}
            disabled={disabled}
            onClick={onToggle}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
