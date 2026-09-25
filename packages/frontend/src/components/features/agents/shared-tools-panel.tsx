import { PanelRightClose, PanelRightOpen, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AgentStudioDevServerPanel,
  type AgentStudioDevServerPanelModel,
} from "./agent-studio-dev-server-panel";
import { AgentStudioDevServerSettingsAction } from "./agent-studio-dev-server-settings-action";
import { shouldUseExpandedDevServerLayout } from "./agent-studio-right-panel-layout";

export type SharedToolsTab<Id extends string> = {
  id: Id;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
  ariaLabel?: string;
  indicator?: ReactNode;
};
export type SharedToolsPanelModel<Id extends string> = {
  tabs: SharedToolsTab<Id>[];
  activeTabId: Id;
  onActiveTabChange: (id: Id) => void;
  tabListLabel: string;
  testIdPrefix: string;
  headerActions: ReactNode;
  devServerModel?: AgentStudioDevServerPanelModel | null;
};

function SharedToolsPanelTabs<Id extends string>({ model }: { model: SharedToolsPanelModel<Id> }) {
  return (
    <TooltipProvider>
      <Tabs
        value={model.activeTabId}
        onValueChange={(value) => {
          const tab = model.tabs.find((entry) => entry.id === value);
          if (tab) model.onActiveTabChange(tab.id);
        }}
        className="h-full min-h-0 gap-0 bg-card"
      >
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border py-1 pr-2">
          <TabsList
            aria-label={model.tabListLabel}
            className="h-9 w-fit shrink-0 gap-0 rounded-none bg-transparent p-0"
          >
            {model.tabs.map((tab, index) => {
              const Icon = tab.icon;
              const active = tab.id === model.activeTabId;
              return (
                <span key={tab.id} className="inline-flex items-center">
                  {index > 0 ? (
                    <span
                      className="h-5 w-px shrink-0 bg-border"
                      aria-hidden="true"
                      data-testid={`${model.testIdPrefix}-tab-separator`}
                    />
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger
                        value={tab.id}
                        aria-label={tab.ariaLabel ?? tab.label}
                        className="group size-9 flex-none cursor-pointer rounded-sm border border-transparent bg-transparent p-0 shadow-none hover:bg-transparent data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                        data-testid={`${model.testIdPrefix}-tab-${tab.id}`}
                      >
                        <span
                          className={`relative inline-flex size-8 items-center justify-center rounded-sm group-hover:bg-muted ${active ? "text-foreground" : "text-muted-foreground/60"}`}
                          data-testid={active ? `${model.testIdPrefix}-tab-active-icon` : undefined}
                        >
                          <Icon className="size-5" aria-hidden="true" />
                          {tab.indicator}
                        </span>
                        <span className="sr-only">{tab.label}</span>
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>{tab.label}</p>
                    </TooltipContent>
                  </Tooltip>
                </span>
              );
            })}
          </TabsList>
          <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2">
            {model.headerActions}
          </div>
        </div>
        {model.tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="min-h-0 overflow-hidden">
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </TooltipProvider>
  );
}

export function SharedToolsPanel<Id extends string>({
  model,
}: {
  model: SharedToolsPanelModel<Id>;
}) {
  const [devServerSettingsIsOpen, setDevServerSettingsIsOpen] = useState(false);
  if (!model.devServerModel) return <SharedToolsPanelTabs model={model} />;
  const expanded = shouldUseExpandedDevServerLayout({
    devServerIsExpanded: model.devServerModel.isExpanded,
    devServerSettingsIsOpen,
  });
  const devServer =
    model.devServerModel.isExpanded === expanded
      ? model.devServerModel
      : { ...model.devServerModel, isExpanded: expanded };
  if (!expanded)
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <SharedToolsPanelTabs model={model} />
        </div>
        <AgentStudioDevServerPanel
          model={devServer}
          compactAction={
            <AgentStudioDevServerSettingsAction
              repositoryPath={model.devServerModel.repoPath}
              onOpenChange={setDevServerSettingsIsOpen}
            />
          }
        />
      </div>
    );
  return (
    <ResizablePanelGroup direction="vertical">
      <ResizablePanel defaultSize={60} minSize={30}>
        <SharedToolsPanelTabs model={model} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={40} minSize={20}>
        <AgentStudioDevServerPanel model={devServer} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export const sharedToolsPanelToggleButtonClassName =
  "size-8 rounded-md border border-transparent bg-transparent text-studio-chrome-foreground hover:border-studio-chrome-foreground/30 hover:bg-studio-chrome-foreground/10";
export function SharedToolsPanelToggleButton({
  label,
  isOpen,
  onToggle,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const actionLabel = `${isOpen ? "Hide" : "Show"} ${label} panel`;
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={sharedToolsPanelToggleButtonClassName}
      onClick={onToggle}
      aria-label={actionLabel}
      title={actionLabel}
    >
      {isOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
    </Button>
  );
}
