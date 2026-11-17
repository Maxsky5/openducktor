import {
  type LucideIcon,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { type ReactElement, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommandPalettePageCommand } from "@/features/command-palette/command-palette-context";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import type { SessionPanelsModel } from "@/features/session-panels";
import { useShortcutLabel } from "@/features/shortcuts/use-shortcut-label";

type SessionViewControlsProps = {
  bottom: SessionPanelsModel["bottomToggle"];
  right: SessionPanelsModel["rightToggle"];
};

/** The session top bar toggles for the bottom panel and the right panel, also in the palette. */
export function SessionViewControls({ bottom, right }: SessionViewControlsProps): ReactElement {
  const bottomView = panelToggleView("bottom", bottom.isOpen);
  const rightView = right ? panelToggleView("right", right.isOpen) : null;
  // Each new command object registers again, so the commands depend on the props only.
  const bottomCommand = useMemo(
    () =>
      bottom.isAvailable
        ? {
            id: "bottom-panel" as const,
            ...panelToggleView("bottom", bottom.isOpen),
            keywords: ["terminal", "shell", "console", "toggle panel"],
            run: bottom.onToggle,
          }
        : null,
    [bottom.isAvailable, bottom.isOpen, bottom.onToggle],
  );
  // The panels model rebuilds `right` often, so the command depends on its fields only.
  const rightIsOpen = right?.isOpen ?? false;
  const rightOnToggle = right?.onToggle ?? null;
  const rightCommand = useMemo(
    () =>
      rightOnToggle
        ? {
            id: "right-panel" as const,
            ...panelToggleView("right", rightIsOpen),
            keywords: ["artifacts", "files", "git", "toggle panel"],
            run: rightOnToggle,
          }
        : null,
    [rightIsOpen, rightOnToggle],
  );
  // Kept views also show these controls, but only the active view owns the palette commands.
  const isActive = useSessionViewActive();
  const bottomShortcut = useShortcutLabel("bottom-panel");
  const rightShortcut = useShortcutLabel("right-panel");
  useCommandPalettePageCommand(isActive ? bottomCommand : null);
  useCommandPalettePageCommand(isActive ? rightCommand : null);
  return (
    <TooltipProvider>
      <div role="group" aria-label="Session views" className="flex shrink-0 items-center gap-2">
        <PanelToggleButton
          label={bottomView.label}
          icon={bottomView.icon}
          isOpen={bottom.isOpen}
          disabled={!bottom.isAvailable}
          shortcut={isActive && bottom.isAvailable ? bottomShortcut : null}
          onToggle={bottom.onToggle}
        />
        {right && rightView ? (
          <PanelToggleButton
            label={rightView.label}
            icon={rightView.icon}
            isOpen={right.isOpen}
            disabled={false}
            shortcut={isActive ? rightShortcut : null}
            onToggle={right.onToggle}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

type PanelToggleView = { label: string; icon: LucideIcon };

const PANEL_ICONS = {
  bottom: { show: PanelBottomOpen, hide: PanelBottomClose },
  right: { show: PanelRightOpen, hide: PanelRightClose },
} as const;

/** A toggle hides an open panel and shows a closed one. */
const panelToggleView = (panel: "bottom" | "right", isOpen: boolean): PanelToggleView => ({
  label: `${isOpen ? "Hide" : "Show"} ${panel} panel`,
  icon: isOpen ? PANEL_ICONS[panel].hide : PANEL_ICONS[panel].show,
});

function PanelToggleButton({
  label,
  icon: Icon,
  isOpen,
  disabled,
  shortcut,
  onToggle,
}: {
  label: string;
  icon: LucideIcon;
  isOpen: boolean;
  disabled: boolean;
  shortcut: string | null;
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
      <TooltipContent side="bottom">
        {label}
        {shortcut ? (
          <>
            {" "}
            <span className="ml-1 font-mono text-xs opacity-75">{shortcut}</span>
          </>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
