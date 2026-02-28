import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  AgentStudioWorkspaceSidebar,
  type AgentStudioWorkspaceSidebarModel,
} from "./agent-studio-workspace-sidebar";

export type AgentStudioRightPanelKind = "documents" | "diff";

export type AgentStudioRightPanelToggleModel = {
  kind: AgentStudioRightPanelKind;
  isOpen: boolean;
  onToggle: () => void;
};

export type AgentStudioRightPanelModel = {
  kind: AgentStudioRightPanelKind;
  documentsModel: AgentStudioWorkspaceSidebarModel;
};

const rightPanelLabel = (kind: AgentStudioRightPanelKind): string => {
  if (kind === "documents") {
    return "documents";
  }
  return "file diff";
};

export function AgentStudioRightPanelToggleButton({
  model,
}: {
  model: AgentStudioRightPanelToggleModel;
}): ReactElement {
  const panelLabel = rightPanelLabel(model.kind);

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-10 w-10 rounded-md border border-transparent bg-transparent text-studio-chrome-foreground hover:border-studio-chrome-foreground/30 hover:bg-studio-chrome-foreground/10"
      onClick={model.onToggle}
      aria-label={model.isOpen ? `Hide ${panelLabel} panel` : `Show ${panelLabel} panel`}
      title={model.isOpen ? `Hide ${panelLabel} panel` : `Show ${panelLabel} panel`}
    >
      {model.isOpen ? (
        <PanelRightClose className="size-4" />
      ) : (
        <PanelRightOpen className="size-4" />
      )}
    </Button>
  );
}

export function AgentStudioRightPanel({
  model,
}: {
  model: AgentStudioRightPanelModel;
}): ReactElement {
  if (model.kind === "documents") {
    return <AgentStudioWorkspaceSidebar model={model.documentsModel} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="space-y-1 border-b border-border p-4">
        <h2 className="text-lg font-semibold leading-none tracking-tight">File Diff</h2>
        <p className="text-sm text-muted-foreground">
          Latest builder file changes for this task session.
        </p>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">File diff panel is not available yet.</p>
      </div>
    </div>
  );
}
