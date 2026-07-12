import type { TerminalConnectionState, TerminalLifecycle } from "@openducktor/contracts";
import { Plus, RotateCw, X } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  return tab.summary?.lifecycle === "exited" ? "Exited" : "Running";
};

function TerminalViewport({
  tab,
  model,
  active,
  onAttention,
  onConnectionState,
  onLifecycle,
}: {
  tab: AgentStudioTerminalTab;
  model: AgentStudioTerminalPanelModel;
  active: boolean;
  onAttention: (tabId: string, message: string | null) => void;
  onConnectionState: (terminalId: string, state: TerminalConnectionState) => void;
  onLifecycle: (terminalId: string, lifecycle: TerminalLifecycle, exitText: string | null) => void;
}): ReactElement {
  const handleAttention = useCallback(
    (message: string | null) => onAttention(tab.tabId, message),
    [onAttention, tab.tabId],
  );
  const terminalId = tab.terminalId;
  const handleConnectionState = useCallback(
    (state: TerminalConnectionState) => {
      if (terminalId) onConnectionState(terminalId, state);
    },
    [onConnectionState, terminalId],
  );
  const handleLifecycle = useCallback(
    (lifecycle: TerminalLifecycle, exitText: string | null) => {
      if (terminalId) onLifecycle(terminalId, lifecycle, exitText);
    },
    [onLifecycle, terminalId],
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
  if (!terminalId || !model.controller) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-muted-foreground">
        Creating terminal…
      </div>
    );
  }
  return (
    <InteractiveTerminal
      terminalId={terminalId}
      controller={model.controller}
      active={active}
      focusRequest={model.focusRequest}
      onAttention={handleAttention}
      onConnectionState={handleConnectionState}
      onLifecycle={handleLifecycle}
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
  const [lifecycleByTerminal, setLifecycleByTerminal] = useState<Record<string, TerminalLifecycle>>(
    {},
  );
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
      setLifecycleByTerminal((current) => ({ ...current, [terminalId]: lifecycle }));
      const tab = model.tabs.find((candidate) => candidate.terminalId === terminalId);
      if (tab && exitText) setTabAttention(tab.tabId, exitText);
    },
    [model.tabs, setTabAttention],
  );
  const closeTab = async (tab: AgentStudioTerminalTab): Promise<void> => {
    try {
      setCloseError(null);
      const lifecycle = tab.terminalId ? lifecycleByTerminal[tab.terminalId] : undefined;
      if (
        lifecycle === "exited" ||
        tab.summary?.lifecycle === "exited" ||
        tab.terminalId === null
      ) {
        await model.onClose(tab, false);
        return;
      }
      setCloseCandidate(tab);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-t border-border bg-card">
      <div className="flex min-h-10 items-center gap-2 border-b border-border px-2">
        <Button
          type="button"
          size="sm"
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
                className="h-8 max-w-full justify-start overflow-x-auto rounded-md"
              >
                {model.tabs.map((tab) => (
                  <div key={tab.tabId} className="flex items-center">
                    <TabsTrigger value={tab.tabId} className="max-w-44">
                      <span className="truncate">{tab.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {lifecycleText(tab)}
                      </span>
                    </TabsTrigger>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Close ${tab.label}`}
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
            <p className="text-xs text-muted-foreground">No terminals for this task.</p>
          )}
        </div>
        <Badge variant="secondary">
          {model.tabs.filter((tab) => tab.summary?.lifecycle === "running").length} running
        </Badge>
        {model.connectionState === "disconnected" ? (
          <Button type="button" size="sm" variant="outline" onClick={model.onReconnect}>
            <RotateCw data-icon="inline-start" />
            Reconnect
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={model.onCreate}
          disabled={model.isLoading || model.isCreating || model.tabs.length >= 8}
        >
          <Plus data-icon="inline-start" />
          New terminal
        </Button>
      </div>
      {activeTab ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-xs">
            <span className="font-medium text-foreground">{activeTab.label}</span>
            <span className="text-muted-foreground">
              Task: {activeTab.summary?.context.taskId ?? model.taskId ?? "None"}
            </span>
            <span className="min-w-0 truncate text-muted-foreground">
              Started in: {activeTab.summary?.initialWorkingDir ?? "Not started"}
            </span>
            <Badge variant="outline">
              Lifecycle:{" "}
              {activeTab.terminalId
                ? (lifecycleByTerminal[activeTab.terminalId] ?? lifecycleText(activeTab))
                : lifecycleText(activeTab)}
            </Badge>
            <Badge variant="outline">
              Connection:{" "}
              {model.connectionState === "disconnected"
                ? "disconnected"
                : activeTab.terminalId
                  ? (connectionByTerminal[activeTab.terminalId] ?? "attaching")
                  : "disconnected"}
            </Badge>
            {activeTab.summary && !activeTab.summary.initialWorkingDirAvailable ? (
              <Badge variant="danger">Started-in directory unavailable</Badge>
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
