import type { TerminalConnectionState, TerminalLifecycle } from "@openducktor/contracts";
import { Plus, RotateCw, X } from "lucide-react";
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
import type {
  AgentStudioTerminalPanelModel,
  AgentStudioTerminalTab,
} from "@/pages/agents/terminals/use-agent-studio-terminals";
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

const connectionText = (
  tab: AgentStudioTerminalTab,
  model: AgentStudioTerminalPanelModel,
  connectionByTerminal: Record<string, TerminalConnectionState>,
): TerminalConnectionState => {
  if (model.connectionState === "disconnected" || !tab.terminalId) return "disconnected";
  return connectionByTerminal[tab.terminalId] ?? "attaching";
};

function TerminalViewport({
  tab,
  model,
  active,
  onAttention,
  onConnectionState,
  onLifecycle,
  onForgotten,
}: {
  tab: AgentStudioTerminalTab;
  model: AgentStudioTerminalPanelModel;
  active: boolean;
  onAttention: (tabId: string, message: string | null) => void;
  onConnectionState: (terminalId: string, state: TerminalConnectionState) => void;
  onLifecycle: (terminalId: string, lifecycle: TerminalLifecycle, exitText: string | null) => void;
  onForgotten: (terminalId: string, message: string) => void;
}): ReactElement {
  const handleAttention = useCallback(
    (message: string | null) => onAttention(tab.tabId, message),
    [onAttention, tab.tabId],
  );
  const handleConnectionState = useCallback(
    (state: TerminalConnectionState) => {
      if (tab.terminalId) onConnectionState(tab.terminalId, state);
    },
    [onConnectionState, tab.terminalId],
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
  if (!tab.terminalId || !model.controller) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-muted-foreground">
        Creating terminal…
      </div>
    );
  }
  return (
    <InteractiveTerminal
      terminalId={tab.terminalId}
      controller={model.controller}
      active={active}
      focusRequest={model.focusRequest}
      onAttention={handleAttention}
      onConnectionState={handleConnectionState}
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
  const [connectionByTerminal, setConnectionByTerminal] = useState<
    Record<string, TerminalConnectionState>
  >({});
  const activeTab = model.tabs.find((tab) => tab.tabId === model.activeTabId) ?? null;
  const setTabAttention = useCallback((tabId: string, message: string | null): void => {
    setAttentionByTab((current) => ({ ...current, [tabId]: message }));
  }, []);
  const setTerminalConnection = useCallback(
    (terminalId: string, state: TerminalConnectionState): void => {
      setConnectionByTerminal((current) => ({ ...current, [terminalId]: state }));
    },
    [],
  );
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
      if (tab.lifecycle === "exited" || tab.terminalId === null) {
        await model.onClose(tab, false);
        return;
      }
      setCloseCandidate(tab);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-1.5">
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
              <TabsList
                aria-label="Task terminal tabs"
                className="h-8 w-full max-w-full justify-start gap-0.5 overflow-x-auto rounded-none bg-transparent p-0"
              >
                {model.tabs.map((tab) => (
                  <div key={tab.tabId} className="flex h-7 shrink-0 items-center">
                    <TabsTrigger
                      value={tab.tabId}
                      aria-label={`${tab.label}, ${lifecycleText(tab)}`}
                      className="h-7 max-w-40 flex-none rounded-md border-0 bg-transparent px-2 py-1 shadow-none data-[state=active]:bg-muted data-[state=active]:shadow-none"
                    >
                      <span className="truncate">{tab.label}</span>
                    </TabsTrigger>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Close ${tab.label}`}
                      className="size-7 text-muted-foreground hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        void closeTab(tab);
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">No terminals for this task.</p>
          )}
        </div>
        {model.connectionState === "disconnected" ? (
          <Button type="button" size="xs" variant="ghost" onClick={model.onReconnect}>
            <RotateCw data-icon="inline-start" />
            Reconnect
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label="New terminal"
          className="text-muted-foreground hover:text-foreground"
          onClick={model.onCreate}
          disabled={model.isLoading || model.isCreating || model.tabs.length >= 8}
        >
          <Plus data-icon="inline-start" />
          New
        </Button>
      </div>
      {activeTab ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-xs">
            <span
              role="status"
              aria-label={`Terminal status: ${lifecycleText(activeTab)}, ${connectionText(activeTab, model, connectionByTerminal)}`}
              className="shrink-0 font-medium text-foreground"
            >
              {lifecycleText(activeTab)}
              <span className="px-1 text-muted-foreground" aria-hidden="true">
                ·
              </span>
              <span className="capitalize">
                {connectionText(activeTab, model, connectionByTerminal)}
              </span>
            </span>
            <span className="text-muted-foreground" aria-hidden="true">
              /
            </span>
            <span
              className="min-w-0 flex-1 truncate text-muted-foreground"
              title={activeTab.summary?.initialWorkingDir ?? undefined}
            >
              Started in: {activeTab.summary?.initialWorkingDir ?? "Not started"}
            </span>
            <span className="sr-only">
              Task association: {activeTab.summary?.context.taskId ?? model.taskId ?? "None"}
            </span>
            {activeTab.summary && !activeTab.summary.initialWorkingDirAvailable ? (
              <span className="shrink-0 text-warning-muted">Started-in directory unavailable</span>
            ) : null}
          </div>
          <Tabs
            value={activeTab.tabId}
            onValueChange={model.onSelectTab}
            className="min-h-0 flex-1 gap-0"
          >
            {model.tabs.map((tab) => (
              <TabsContent
                key={tab.tabId}
                value={tab.tabId}
                forceMount
                className="h-full min-h-0 data-[state=inactive]:hidden"
              >
                <TerminalViewport
                  tab={tab}
                  model={model}
                  active={tab.tabId === activeTab.tabId}
                  onAttention={setTabAttention}
                  onConnectionState={setTerminalConnection}
                  onLifecycle={setTerminalLifecycle}
                  onForgotten={model.onForgotten}
                />
              </TabsContent>
            ))}
          </Tabs>
          {attentionByTab[activeTab.tabId] ? (
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
        onOpenChange={(open) => !open && setCloseCandidate(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Terminate and close {closeCandidate?.label}?</DialogTitle>
            <DialogDescription>
              This stops the running process tree. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCloseCandidate(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const candidate = closeCandidate;
                if (!candidate) return;
                void model.onClose(candidate, true).then(
                  () => setCloseCandidate(null),
                  (cause: unknown) => {
                    setCloseError(cause instanceof Error ? cause.message : String(cause));
                    setCloseCandidate(null);
                  },
                );
              }}
            >
              Terminate and close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
