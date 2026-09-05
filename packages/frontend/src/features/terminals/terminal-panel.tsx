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
  useLayoutEffect,
  useRef,
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

const LazyInteractiveTerminal = lazy(async () => {
  const module = await import("./interactive-terminal");
  return { default: module.InteractiveTerminal };
});

const TerminalViewport = memo(function TerminalViewport({
  scopeKey,
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
  scopeKey: string;
  tab: TerminalTab;
  controller: TerminalPanelModel["controller"];
  focusRequest: number;
  active: boolean;
  platform: AppPlatform | undefined;
  onRetryCreate: TerminalPanelModel["onRetryCreate"];
  onAttention: (tabId: string, message: string | null) => void;
  onLifecycle: (
    scopeKey: string,
    tabId: string,
    terminalId: string,
    lifecycle: TerminalLifecycle,
    exitText: string | null,
  ) => void;
  onForgotten: (scopeKey: string, terminalId: string, message: string) => void;
  onTitleChange: (scopeKey: string, terminalId: string, title: string) => void;
}): ReactElement {
  const handleAttention = useCallback(
    (message: string | null) => onAttention(tab.tabId, message),
    [onAttention, tab.tabId],
  );
  const handleLifecycle = useCallback(
    (lifecycle: TerminalLifecycle, exitText: string | null) => {
      if (tab.terminalId) onLifecycle(scopeKey, tab.tabId, tab.terminalId, lifecycle, exitText);
    },
    [onLifecycle, scopeKey, tab.tabId, tab.terminalId],
  );
  const handleForgotten = useCallback(
    (message: string) => {
      if (tab.terminalId) onForgotten(scopeKey, tab.terminalId, message);
    },
    [onForgotten, scopeKey, tab.terminalId],
  );
  const handleTitleChange = useCallback(
    (title: string) => {
      if (tab.terminalId) onTitleChange(scopeKey, tab.terminalId, title);
    },
    [onTitleChange, scopeKey, tab.terminalId],
  );
  if (tab.error) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-[70ch] text-sm text-destructive">{tab.error}</p>
        {tab.requestState === "lost" || !active ? null : (
          <Button
            type="button"
            variant="outline"
            onClick={() => onRetryCreate(scopeKey, tab.tabId)}
          >
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
      <LazyInteractiveTerminal
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
  const { onLifecycle } = model;
  const [pendingCloseCandidate, setPendingCloseCandidate] = useState<{
    scopeKey: string | null;
    tab: TerminalTab;
  } | null>(null);
  const [attentionByTab, setAttentionByTab] = useState<Record<string, string | null>>({});
  const [exitByTab, setExitByTab] = useState<Record<string, string | null>>({});
  const [pendingCloseError, setPendingCloseError] = useState<{
    scopeKey: string | null;
    message: string;
  } | null>(null);
  const [confirmingScopeKey, setConfirmingScopeKey] = useState<string | null | undefined>(
    undefined,
  );
  const currentScopeKey = useRef(model.scopeKey);
  const retryCreateRef = useRef(model.onRetryCreate);
  useLayoutEffect(() => {
    currentScopeKey.current = model.scopeKey;
    retryCreateRef.current = model.onRetryCreate;
  }, [model.onRetryCreate, model.scopeKey]);
  const retryTerminalCreation = useCallback((ownerScopeKey: string, tabId: string): void => {
    if (ownerScopeKey !== currentScopeKey.current) return;
    retryCreateRef.current(ownerScopeKey, tabId);
  }, []);
  const closeCandidate =
    pendingCloseCandidate?.scopeKey === model.scopeKey ? pendingCloseCandidate.tab : null;
  const closeError =
    pendingCloseError?.scopeKey === model.scopeKey ? pendingCloseError.message : null;
  const isConfirmingClose =
    closeCandidate !== null &&
    confirmingScopeKey !== undefined &&
    confirmingScopeKey === pendingCloseCandidate?.scopeKey;

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
  const hasCurrentScopeMountedTabs = model.mountedTabs.some(
    (mountedTab) => mountedTab.scopeKey === model.scopeKey,
  );
  const showsEmptyTerminalState = model.tabs.length === 0 && !hasCurrentScopeMountedTabs;
  const setTabAttention = useCallback((tabId: string, message: string | null): void => {
    setAttentionByTab((current) => ({ ...current, [tabId]: message }));
  }, []);
  const setTerminalLifecycle = useCallback(
    (
      scopeKey: string,
      tabId: string,
      terminalId: string,
      lifecycle: TerminalLifecycle,
      exitText: string | null,
    ): void => {
      onLifecycle(scopeKey, terminalId, lifecycle);
      setExitByTab((current) => ({ ...current, [tabId]: exitText }));
    },
    [onLifecycle],
  );
  const closeTab = async (tab: TerminalTab): Promise<void> => {
    const scopeKey = model.scopeKey;
    try {
      setPendingCloseError(null);
      const result = await model.onClose(tab, false);
      if (!result.closed && currentScopeKey.current === scopeKey) {
        setPendingCloseCandidate({ scopeKey, tab });
      }
    } catch (cause) {
      if (currentScopeKey.current === scopeKey) {
        setPendingCloseError({
          scopeKey,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  };
  const confirmClose = async (): Promise<void> => {
    const candidate = pendingCloseCandidate;
    if (!candidate || candidate.scopeKey !== model.scopeKey) return;
    setConfirmingScopeKey(candidate.scopeKey);
    setPendingCloseError(null);
    try {
      const result = await model.onClose(candidate.tab, true);
      if (result.closed && currentScopeKey.current === candidate.scopeKey) {
        setPendingCloseCandidate(null);
      }
    } catch (cause) {
      if (currentScopeKey.current === candidate.scopeKey) {
        setPendingCloseError({
          scopeKey: candidate.scopeKey,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    } finally {
      setConfirmingScopeKey((current) => (current === candidate.scopeKey ? undefined : current));
    }
  };
  return (
    <Tabs
      {...(model.activeTabId ? { value: model.activeTabId } : {})}
      onValueChange={model.onSelectTab}
      className="flex h-full min-h-0 flex-col gap-0 overflow-hidden bg-[var(--dev-server-terminal-panel)] text-[var(--dev-server-terminal-foreground)]"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--dev-server-terminal-border)] bg-[var(--dev-server-terminal-surface)]">
        {headerLeading}
        <div className="min-w-0 flex-1">
          {model.tabs.length > 0 ? (
            <TerminalTabStrip
              tabs={model.tabs}
              onSelectTab={model.onSelectTab}
              onReorderTab={model.onReorderTab}
              onCloseTab={(tab) => void closeTab(tab)}
            />
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
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {model.mountedTabs.map((mountedTab) => {
              const active =
                model.isVisible &&
                mountedTab.scopeKey === model.scopeKey &&
                mountedTab.tab.tabId === activeTab?.tabId;
              return (
                <TabsContent
                  key={`${mountedTab.scopeKey}:${mountedTab.tab.tabId}`}
                  forceMount
                  value={mountedTab.tab.tabId}
                  data-terminal-viewport
                  data-viewport-state={active ? "active" : "inactive"}
                  aria-hidden={!active}
                  inert={!active}
                  className="h-full min-h-0 data-[viewport-state=inactive]:pointer-events-none data-[viewport-state=inactive]:absolute data-[viewport-state=inactive]:top-0 data-[viewport-state=inactive]:left-[calc(100%+1px)] data-[viewport-state=inactive]:w-full"
                >
                  <TerminalViewport
                    scopeKey={mountedTab.scopeKey}
                    tab={mountedTab.tab}
                    controller={model.controller}
                    focusRequest={active ? model.focusRequest : 0}
                    active={active}
                    platform={model.platform}
                    onRetryCreate={retryTerminalCreation}
                    onAttention={setTabAttention}
                    onLifecycle={setTerminalLifecycle}
                    onForgotten={model.onForgotten}
                    onTitleChange={model.onTitleChange}
                  />
                </TabsContent>
              );
            })}
          </div>
          {activeTab && (attentionByTab[activeTab.tabId] || exitByTab[activeTab.tabId]) ? (
            <p
              role="status"
              aria-label="Terminal status"
              className="border-t border-border bg-warning-surface px-3 py-1.5 text-xs text-warning-surface-foreground"
            >
              {attentionByTab[activeTab.tabId] ?? exitByTab[activeTab.tabId]}
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
        onOpenChange={(open) => !open && !isConfirmingClose && setPendingCloseCandidate(null)}
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
              onClick={() => setPendingCloseCandidate(null)}
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
    </Tabs>
  );
}
