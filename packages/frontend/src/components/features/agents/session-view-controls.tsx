import { SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
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
    <div
      role="group"
      aria-label="Session views"
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-input bg-muted/50 p-0.5 shadow-sm"
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={sharedToolsPanelToggleButtonClassName}
        aria-label={terminalLabel}
        aria-pressed={terminal.isVisible}
        title={terminalLabel}
        disabled={!terminal.isAvailable}
        onClick={terminal.onToggle}
      >
        <SquareTerminal aria-hidden="true" />
      </Button>
      {tools ? <SharedToolsPanelToggleButton {...tools} /> : null}
    </div>
  );
}
