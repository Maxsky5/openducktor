import { SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TerminalPanelModel } from "@/features/terminals/use-terminals";
import {
  SharedToolsPanelToggleButton,
  sharedToolsPanelToggleButtonClassName,
} from "./shared-tools-panel";

type SessionViewControlsProps = {
  terminal: Pick<TerminalPanelModel, "isAvailable" | "isVisible" | "onToggle">;
  tools: { label: string; isOpen: boolean; onToggle: () => void } | null;
};

export function SessionViewControls({ terminal, tools }: SessionViewControlsProps): ReactElement {
  const terminalLabel = terminal.isVisible ? "Hide terminal" : "Show terminal";
  return (
    <TooltipProvider>
      <div role="group" aria-label="Session views" className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={sharedToolsPanelToggleButtonClassName}
                aria-label={terminalLabel}
                aria-pressed={terminal.isVisible}
                disabled={!terminal.isAvailable}
                onClick={terminal.onToggle}
              >
                <SquareTerminal aria-hidden="true" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{terminalLabel}</TooltipContent>
        </Tooltip>
        {tools ? <SharedToolsPanelToggleButton {...tools} /> : null}
      </div>
    </TooltipProvider>
  );
}
