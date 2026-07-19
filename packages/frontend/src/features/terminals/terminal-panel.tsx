import type { AppPlatform, TerminalLifecycle } from "@openducktor/contracts";
import { Loader2, Plus } from "lucide-react";
import {
  lazy,
  memo,
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { terminalTabLabel } from "./terminal-presentation-state";
import { TerminalTabStrip } from "./terminal-tab-strip";
import type { TerminalPanelModel, TerminalTab } from "./use-terminals";

const InteractiveTerminal = lazy(async () => {
  const module = await import("./interactive-terminal");
  return { default: module.InteractiveTerminal };
});

const TerminalViewport = memo(function TerminalViewport({
  tab,
  controller,
  focusRequest,
  active,
  platform,
  onRetryCreate,
  onAttention,
  onLifecycle,
  onForgotten,
  onTitleChange,
}: {
  tab: TerminalTab;
  controller: TerminalPanelModel["controller"];
  focusRequest: number;
  active: boolean;
  platform: AppPlatform | undefined;
  onRetryCreate: TerminalPanelModel["onRetryCreate"];
  onAttention: (tabId: string, message: string | null) => void;
  onLifecycle: (
    tabId: string,
    terminalId: string,
    lifecycle: TerminalLifecycle,
    exitText: string | null,
  ) => void;
  onForgotten: (terminalId: string, message: string) => void;
  onTitleChange: (terminalId: string, title: string) => void;
}): ReactElement {
  const handleAttention = useCallback(
    (message: string | null) => onAttention(tab.tabId, message),
    [onAttention, tab.tabId],
  );
  const handleLifecycle = useCallback(
    (lifecycle: TerminalLifecycle, exitText: string | null) => {
      if (tab.terminalId) onLifecycle(tab.tabId, tab.terminalId, lifecycle, exitText);
    },
    [onLifecycle, tab.tabId, tab.terminalId],
  );
  const handleForgotten = useCallback(
    (message: string) => {
      if (tab.terminalId) onForgotten(tab.terminalId, message);
    },
    [onForgotten, tab.terminalId],
  );
  const handleTitleChange = useCallback(
    (title: string) => {
      if (tab.terminalId) onTitleChange(tab.terminalId, title);
    },
    [onTitleChange, tab.terminalId],
  );
  if (tab.error) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-[70ch] text-sm text-destructive">{tab.error}</p>
        {tab.requestState === "lost" ? null : (
          <Button type="button" variant="outline" onClick={() => onRetryCreate(tab.tabId)}>
            Retry terminal creation
          </Button>
        )}
      </div>
    );
  }
  if (!tab.terminalId) {
    return (
      <div
        data-testid="terminal-starting-surface"
        className="h-full min-h-0 bg-[var(--dev-server-terminal-panel)]"
      />
    );
  }
  if (!controller) {
    return (
      <div
        data-testid="terminal-unavailable-surface"
        className="h-full min-h-0 bg-[var(--dev-server-terminal-panel)]"
      />
    );
  }
  return (
    <Suspense
      fallback={
        <div
          data-testid="terminal-loading-surface"
          className="h-full min-h-0 bg-[var(--dev-server-terminal-panel)]"
        />
      }
    >
      <InteractiveTerminal
        terminalId={tab.terminalId}
        controller={controller}
        platform={platform}
        active={active}
        focusRequest={focusRequest}
        onAttention={handleAttention}
        onLifecycle={handleLifecycle}
        onForgotten={handleForgotten}
        onTitleChange={handleTitleChange}
      />
    </Suspense>
  );
});

export function TerminalPanel({
  model,
  headerLeading,
}: {
  model: TerminalPanelModel;
  headerLeading?: ReactNode;
}): ReactElement {
  const [closeCandidate, setCloseCandidate] = useState<TerminalTab | null>(null);
  const [attentionByTab, setAttentionByTab] = useState<Record<string, string | null>>({});
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);

  useEffect(() => {
    if (!model.platformError) return;
    const toastId = "terminal:platform";
    toast.error("Terminal shortcuts unavailable", {
      id: toastId,
      description: model.platformError,
    });
    return () => {
      toast.dismiss(toastId);
    };
  }, [model.platformError]);
  const activeTab = model.tabs.find((tab) => tab.tabId === model.activeTabId) ?? null;
  const showsEmptyTerminalState = model.tabs.length === 0 && model.mountedTabs.length === 0;
  const setTabAttention = useCallback((tabId: string, message: string | null): void => {
    setAttentionByTab((current) => ({ ...current, [tabId]: message }));
  }, []);
  const setTerminalLifecycle = useCallback(
    (
      tabId: string,
      terminalId: string,
      lifecycle: TerminalLifecycle,
      exitText: string | null,
    ): void => {
      model.onLifecycle(terminalId, lifecycle);
      if (exitText) setTabAttention(tabId, exitText);
    },
    [model.onLifecycle, setTabAttention],
  );
  const closeTab = async (tab: TerminalTab): Promise<void> => {
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
        {headerLeading}
        <div className="min-w-0 flex-1">
          {model.tabs.length > 0 ? (
            <Tabs
              {...(model.activeTabId ? { value: model.activeTabId } : {})}
              onValueChange={model.onSelectTab}
              className="gap-0"
            >
              <TerminalTabStrip
                tabs={model.tabs}
                onSelectTab={model.onSelectTab}
                onReorderTab={model.onReorderTab}
                onCloseTab={(tab) => void closeTab(tab)}
              />
            </Tabs>
          ) : null}
          {showsEmptyTerminalState ? (
            <p className="px-1 text-xs text-muted-foreground">No terminals.</p>
          ) : null}
        </div>
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
            className="relative min-h-0 flex-1 gap-0 overflow-hidden"
          >
            {model.mountedTabs.map((tab) => (
              <TabsContent
                key={tab.tabId}
                value={tab.tabId}
                forceMount
                className="h-full min-h-0 data-[state=inactive]:pointer-events-none data-[state=inactive]:absolute data-[state=inactive]:inset-0 data-[state=inactive]:invisible"
              >
                <TerminalViewport
                  tab={tab}
                  controller={model.controller}
                  focusRequest={model.focusRequest}
                  active={tab.tabId === activeTab?.tabId}
                  platform={model.platform}
                  onRetryCreate={model.onRetryCreate}
                  onAttention={setTabAttention}
                  onLifecycle={setTerminalLifecycle}
                  onForgotten={model.onForgotten}
                  onTitleChange={model.onTitleChange}
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
          Create a terminal.
        </div>
      )}
      {model.transportError ? (
        <p className="bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          Terminal transport failed: {model.transportError}
        </p>
      ) : null}

      <Dialog
        open={closeCandidate !== null}
        onOpenChange={(open) => !open && !isConfirmingClose && setCloseCandidate(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Terminate and close {closeCandidate ? terminalTabLabel(closeCandidate) : "terminal"}?
            </DialogTitle>
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
