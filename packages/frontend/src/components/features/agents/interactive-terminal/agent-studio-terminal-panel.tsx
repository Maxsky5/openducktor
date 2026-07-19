import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/features/terminals";
import type { AgentStudioTerminalPanelModel } from "@/pages/agents/terminals/use-agent-studio-terminals";

export function AgentStudioTerminalPanel({
  model,
}: {
  model: AgentStudioTerminalPanelModel;
}): ReactElement {
  return (
    <TerminalPanel
      model={model}
      headerLeading={
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="md:hidden"
          onClick={model.onHide}
        >
          Back to workspace
        </Button>
      }
    />
  );
}
