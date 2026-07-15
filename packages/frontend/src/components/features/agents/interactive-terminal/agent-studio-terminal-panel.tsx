import type { TerminalConnectionState, TerminalLifecycle } from "@openducktor/contracts";
import { Loader2, Plus, RotateCw, X } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  AgentStudioTerminalPanelModel,
  AgentStudioTerminalTab,
} from "@/pages/agents/terminals/use-agent-studio-terminals";
import { terminalTabsListClassName, terminalTabTriggerClassName } from "../terminal-tab-styles";
import { InteractiveTerminal } from "./interactive-terminal";

const lifecycleText = (tab: AgentStudioTerminalTab): string => {
  if (tab.requestState === "creating") return "Creating";
  if (tab.requestState === "unsupported_runtime") return "Unsupported runtime";
  if (tab.requestState === "creation_failed") return "Creation failed";
  if (tab.requestState === "lost") return "Lost after host restart";
  if (tab.lifecycle === "starting") return "Starting";
  if (tab.lifecycle === "closing") return "Closing";
  if (tab.lifecycle === "close_failed") return "Close failed";
  if (tab.lifecycle === "exited") return "Exited";
  return "Running";
};

const ignoreConnectionState = (_state: TerminalConnectionState): void => undefined;

function TerminalViewport({
  tab,
  model,
  active,
  onAttention,
  onLifecycle,
  onForgotten,
}: {
  tab: AgentStudioTerminalTab;
  model: AgentStudioTerminalPanelModel;
  active: boolean;
  onAttention: (tabId: string, message: string | null) => void;
  onLifecycle: (terminalId: string, lifecycle: TerminalLifecycle, exitText: string | null) => void;
  onForgotten: (terminalId: string, message: string) => void;
}): ReactElement {
  const handleAttention = useCallback(
    (message: string | null) => onAttention(tab.tabId, message),
    [onAttention, tab.tabId],
  );
  const handleLifecycle = useCallback(
    (lifecycle: TerminalLifecycle, exitText: string | null) => {
      if (tab.terminalId) onLifecycle(tab.terminalId, lifecycle, exitText);
    },
    [onLifecycle, tab.terminalId],
  );
  const handleForgotten = useCallback(
    (message: string) => {
      if (tab.terminalId) onForgotten(tab.terminalId, message);
    },
    [onForgotten, tab.terminalId],
  );
  if (tab.error) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-[70ch] text-sm text-destructive">{tab.error}</p>
        {tab.requestState === "lost" ? null : (
          <Button type="button" variant="outline" onClick={() => model.onRetryCreate(tab.tabId)}>
            Retry terminal creation
          </Button>
        )}
      </div>
    );
  }
  if (!tab.terminalId) {
    return (
      <div
        data-testid="agent-studio-terminal-starting-surface"
        className="h-full min-h-0 bg-[var(--dev-server-terminal-panel)]"
      />
    );
  }
  if (!model.controller) {
    return (
      <div
        data-testid="agent-studio-terminal-unavailable-surface"
        className="h-full min-h-0 bg-[var(--dev-server-terminal-panel)]"
      />
    );
  }
  return (
    <InteractiveTerminal
      terminalId={tab.terminalId}
      controller={model.controller}
      active={active}
      focusRequest={model.focusRequest}
      onAttention={handleAttention}
      onConnectionState={ignoreConnectionState}
      onLifecycle={handleLifecycle}
      onForgotten={handleForgotten}
    />
  );
}

export function AgentStudioTerminalPanel({
  model,
}: {
  model: AgentStudioTerminalPanelModel;
}): ReactElement {
  const [closeCandidate, setCloseCandidate] = useState<AgentStudioTerminalTab | null>(null);
  const [attentionByTab, setAttentionByTab] = useState<Record<string, string | null>>({});
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const activeTab = model.tabs.find((tab) => tab.tabId === model.activeTabId) ?? null;
  const showsEmptyTerminalState = model.tabs.length === 0 && model.mountedTabs.length === 0;
  const setTabAttention = useCallback((tabId: string, message: string | null): void => {
    setAttentionByTab((current) => ({ ...current, [tabId]: message }));
  }, []);
  const setTerminalLifecycle = useCallback(
    (terminalId: string, lifecycle: TerminalLifecycle, exitText: string | null): void => {
      model.onLifecycle(terminalId, lifecycle);
      const tab = model.tabs.find((candidate) => candidate.terminalId === terminalId);
      if (tab && exitText) setTabAttention(tab.tabId, exitText);
    },
    [model, setTabAttention],
  );
  const closeTab = async (tab: AgentStudioTerminalTab): Promise<void> => {
    try {
      setCloseError(null);
      const result = await model.onClose(tab, false);
      if (!result.closed) setCloseCandidate(tab);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const confirmClose = async (): Promise<void> => {
    const candidate = closeCandidate;
    if (!candidate) return;
    setIsConfirmingClose(true);
    setCloseError(null);
    try {
      const result = await model.onClose(candidate, true);
      if (result.closed) setCloseCandidate(null);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsConfirmingClose(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--dev-server-terminal-panel)] text-[var(--dev-server-terminal-foreground)]">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--dev-server-terminal-border)] bg-[var(--dev-server-terminal-surface)]">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="md:hidden"
          onClick={model.onBackToChat}
        >
          Back to chat
        </Button>
        <div className="min-w-0 flex-1">
          {model.tabs.length > 0 ? (
            <Tabs
              {...(model.activeTabId ? { value: model.activeTabId } : {})}
              onValueChange={model.onSelectTab}
              className="gap-0"
            >
              <TabsList aria-label="Task terminal tabs" className={terminalTabsListClassName}>
                {model.tabs.map((tab) => {
                  const detail = tab.summary
                    ? `${lifecycleText(tab)}. Started in ${tab.summary.initialWorkingDir}`
                    : lifecycleText(tab);
                  return (
                    <div key={tab.tabId} className="group relative flex h-8 shrink-0 items-center">
                      <TabsTrigger
                        value={tab.tabId}
                        aria-label={`${tab.label}, ${lifecycleText(tab)}`}
                        title={detail}
                        className={cn(terminalTabTriggerClassName, "max-w-48 pr-8")}
                      >
                        <span className="truncate">{tab.label}</span>
                      </TabsTrigger>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Close ${tab.label}`}
                        aria-busy={tab.lifecycle === "closing"}
                        className="absolute right-1 z-20 size-6 rounded-sm text-[var(--dev-server-terminal-foreground)] hover:bg-[var(--dev-server-terminal-surface)] hover:text-[var(--dev-server-terminal-foreground)]"
                        disabled={tab.lifecycle === "closing"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void closeTab(tab);
                        }}
                      >
                        {tab.lifecycle === "closing" ? <Loader2 className="animate-spin" /> : <X />}
                      </Button>
                    </div>
                  );
                })}
              </TabsList>
            </Tabs>
          ) : null}
          {showsEmptyTerminalState ? (
            <p className="px-1 text-xs text-muted-foreground">No terminals for this task.</p>
          ) : null}
        </div>
        {model.connectionState === "disconnected" ? (
          <Button type="button" size="xs" variant="ghost" onClick={model.onReconnect}>
            <RotateCw data-icon="inline-start" />
            Reconnect
          </Button>
        ) : null}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="New terminal"
                className="size-8 text-(--dev-server-terminal-foreground) shadow-none hover:bg-(--dev-server-terminal-tab-inactive) hover:text-(--dev-server-terminal-foreground)"
                onClick={model.onCreate}
                disabled={model.isLoading || model.isCreating || model.tabs.length >= 8}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">New terminal</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {model.mountedTabs.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Tabs
            value={activeTab?.tabId ?? "pending-terminal-close"}
            onValueChange={model.onSelectTab}
            className="min-h-0 flex-1 gap-0"
          >
            {model.mountedTabs.map((tab) => (
              <TabsContent
                key={tab.tabId}
                value={tab.tabId}
                forceMount
                className="h-full min-h-0 data-[state=inactive]:hidden"
              >
                <TerminalViewport
                  tab={tab}
                  model={model}
                  active={tab.tabId === activeTab?.tabId}
                  onAttention={setTabAttention}
                  onLifecycle={setTerminalLifecycle}
                  onForgotten={model.onForgotten}
                />
              </TabsContent>
            ))}
          </Tabs>
          {activeTab && attentionByTab[activeTab.tabId] ? (
            <p className="border-t border-border bg-warning-surface px-3 py-1.5 text-xs text-warning-surface-foreground">
              {attentionByTab[activeTab.tabId]}
            </p>
          ) : null}
          {closeError ? (
            <p className="border-t border-border px-3 py-1.5 text-xs text-destructive">
              Close failed: {closeError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          Create a terminal in this task worktree.
        </div>
      )}
      {model.transportError ? (
        <p className="bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          Terminal connection failed: {model.transportError}
        </p>
      ) : null}

      <Dialog
        open={closeCandidate !== null}
        onOpenChange={(open) => !open && !isConfirmingClose && setCloseCandidate(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Terminate and close {closeCandidate?.label}?</DialogTitle>
            <DialogDescription>
              This stops the running process tree. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-between border-t border-border pt-5 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCloseCandidate(null)}
              disabled={isConfirmingClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmClose()}
              disabled={isConfirmingClose}
            >
              {isConfirmingClose ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : null}
              Terminate and close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
