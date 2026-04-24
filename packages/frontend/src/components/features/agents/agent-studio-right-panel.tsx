import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactElement } from "react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import {
  AgentStudioDevServerPanel,
  type AgentStudioDevServerPanelModel,
} from "./agent-studio-dev-server-panel";
import { AgentStudioGitPanel, type AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import {
  AgentStudioWorkspaceSidebar,
  type AgentStudioWorkspaceSidebarModel,
} from "./agent-studio-workspace-sidebar";

export type AgentStudioRightPanelKind = "documents" | "build_tools";

export type AgentStudioRightPanelToggleModel = {
  kind: AgentStudioRightPanelKind;
  isOpen: boolean;
  onToggle: () => void;
};

export type AgentStudioRightPanelModel =
  | {
      kind: "documents";
      documentsModel: AgentStudioWorkspaceSidebarModel;
    }
  | {
      kind: "build_tools";
      diffModel: AgentStudioGitPanelModel;
      devServerModel: AgentStudioDevServerPanelModel;
    };

const rightPanelLabel = (kind: AgentStudioRightPanelKind): string => {
  if (kind === "documents") {
    return "documents";
  }
  return "builder tools";
};

function AgentStudioBuildToolsPanel({
  diffModel,
  devServerModel,
}: {
  diffModel: AgentStudioGitPanelModel;
  devServerModel: AgentStudioDevServerPanelModel;
}): ReactElement {
  if (!devServerModel.isExpanded) {
    return (
      <DiffWorkerProvider>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgentStudioGitPanel model={diffModel} />
          </div>
          <AgentStudioDevServerPanel model={devServerModel} />
        </div>
      </DiffWorkerProvider>
    );
  }

  return (
    <DiffWorkerProvider>
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={60} minSize={30}>
          <AgentStudioGitPanel model={diffModel} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={40} minSize={20}>
          <AgentStudioDevServerPanel model={devServerModel} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </DiffWorkerProvider>
  );
}

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
    <AgentStudioBuildToolsPanel diffModel={model.diffModel} devServerModel={model.devServerModel} />
  );
}

export const MemoizedAgentStudioRightPanel = memo(AgentStudioRightPanel);
