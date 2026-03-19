import type { DevServerScriptState } from "@openducktor/contracts";
import { Play, RefreshCw, Server, SquareTerminal } from "lucide-react";
import {
  memo,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type AgentStudioDevServerPanelMode = "loading" | "empty" | "disabled" | "stopped" | "active";

export type AgentStudioDevServerPanelModel = {
  mode: AgentStudioDevServerPanelMode;
  isExpanded: boolean;
  isLoading: boolean;
  repoPath: string | null;
  taskId: string | null;
  worktreePath: string | null;
  scripts: DevServerScriptState[];
  selectedScriptId: string | null;
  selectedScript: DevServerScriptState | null;
  error: string | null;
  isStartPending: boolean;
  isStopPending: boolean;
  isRestartPending: boolean;
  onSelectScript: (scriptId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
};

const AUTO_SCROLL_THRESHOLD_PX = 48;

const formatLogTimestamp = (timestamp: string): string => {
  if (timestamp.length >= 19) {
    return timestamp.slice(11, 19);
  }

  return timestamp;
};

const streamClassName = (stream: "stdout" | "stderr" | "system"): string => {
  if (stream === "stderr") {
    return "text-rose-700 dark:text-rose-300";
  }

  if (stream === "system") {
    return "text-sky-700 dark:text-sky-300";
  }

  return "text-foreground";
};

const statusClassName = (isActive: boolean): string => {
  if (!isActive) {
    return "border-border bg-muted text-muted-foreground";
  }

  return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300";
};

export const AgentStudioDevServerPanel = memo(function AgentStudioDevServerPanel({
  model,
}: {
  model: AgentStudioDevServerPanelModel;
}): ReactElement {
  const logViewportContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [logViewport, setLogViewport] = useState<HTMLElement | null>(null);
  const selectedScript = model.selectedScript;
  const hasSelectedScriptLogs = Boolean(
    selectedScript && selectedScript.bufferedLogLines.length > 0,
  );
  const isActionPending = model.isStartPending || model.isStopPending || model.isRestartPending;
  const hasExpandedActions = model.mode === "active";
  const selectedTabsValue = model.selectedScriptId ?? model.scripts[0]?.scriptId ?? "__none__";
  const selectedScriptContent = selectedScript ?? model.scripts[0] ?? null;
  const selectedScriptLogCount = selectedScriptContent?.bufferedLogLines.length ?? 0;
  const renderedLogLines = useMemo(() => {
    if (!selectedScriptContent) {
      return [];
    }

    const keyOccurrences = new Map<string, number>();
    return selectedScriptContent.bufferedLogLines.map((logLine) => {
      const baseKey = `${logLine.timestamp}:${logLine.stream}:${logLine.text}`;
      const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1;
      keyOccurrences.set(baseKey, occurrence);
      return {
        key: `${baseKey}:${occurrence}`,
        logLine,
      };
    });
  }, [selectedScriptContent]);

  useLayoutEffect(() => {
    if (selectedTabsValue === "__none__") {
      setLogViewport(null);
      return;
    }

    const nextViewport = logViewportContainerRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    setLogViewport((currentViewport) =>
      currentViewport === nextViewport ? currentViewport : (nextViewport ?? null),
    );
  }, [selectedTabsValue]);

  useEffect(() => {
    if (!logViewport) {
      return;
    }

    const updateAutoScroll = (): void => {
      const distanceFromBottom =
        logViewport.scrollHeight - logViewport.scrollTop - logViewport.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
    };

    updateAutoScroll();
    logViewport.addEventListener("scroll", updateAutoScroll);
    return () => {
      logViewport.removeEventListener("scroll", updateAutoScroll);
    };
  }, [logViewport]);

  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return;
    }

    if (selectedTabsValue === "__none__") {
      return;
    }

    if (!logViewport) {
      return;
    }

    if (selectedScriptLogCount === 0) {
      logViewport.scrollTop = 0;
      return;
    }

    logViewport.scrollTop = logViewport.scrollHeight;
  }, [logViewport, selectedScriptLogCount, selectedTabsValue]);

  const headerSummary = useMemo(() => {
    if (model.mode === "empty") {
      return "Configure one or more builder dev server commands in repository settings to stream them here.";
    }

    if (model.mode === "disabled") {
      return "Create or resume a Builder worktree before starting repository dev servers.";
    }

    if (model.mode === "loading") {
      return "Loading builder dev server state...";
    }

    if (model.mode === "stopped") {
      return "Start the configured builder dev servers for this task worktree.";
    }

    return model.worktreePath
      ? `Running in ${model.worktreePath}`
      : "Builder dev server logs stream here while the task worktree is active.";
  }, [model.mode, model.worktreePath]);

  if (!hasExpandedActions) {
    const isEmpty = model.mode === "empty";
    const isDisabled = model.mode === "disabled";
    const isLoading = model.mode === "loading";
    const startDisabled = isEmpty || isDisabled || isLoading || isActionPending;
    const startLabel = isLoading
      ? "Loading dev servers..."
      : model.isStartPending
        ? "Starting dev servers..."
        : "Start dev servers";

    return (
      <div
        className="border-t border-border bg-card/70 px-3 py-3"
        data-testid="agent-studio-dev-server-compact-panel"
      >
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={startDisabled}
            onClick={model.onStart}
            data-testid="agent-studio-dev-server-start-button"
          >
            <Play className="size-4" />
            {startLabel}
          </Button>
          <div
            className="min-w-0 flex-1 text-sm text-muted-foreground"
            data-testid="agent-studio-dev-server-compact-message"
          >
            {headerSummary}
          </div>
        </div>
        {model.error ? (
          <div
            className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="agent-studio-dev-server-error-banner"
          >
            {model.error}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card"
      data-testid="agent-studio-dev-server-expanded-panel"
    >
      <div className="border-b border-border px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <SquareTerminal className="size-4 text-muted-foreground" />
              Builder dev servers
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  statusClassName(model.scripts.some((script) => script.status !== "stopped")),
                )}
                data-testid="agent-studio-dev-server-status-badge"
              >
                {model.scripts.some((script) => script.status !== "stopped") ? "Active" : "Stopped"}
              </span>
            </div>
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid="agent-studio-dev-server-header-summary"
            >
              {headerSummary}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isActionPending}
              onClick={model.onStop}
              data-testid="agent-studio-dev-server-stop-button"
            >
              <Server className="size-4" />
              {model.isStopPending ? "Stopping..." : "Stop"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isActionPending}
              onClick={model.onRestart}
              data-testid="agent-studio-dev-server-restart-button"
            >
              <RefreshCw
                className={cn("size-4", model.isRestartPending ? "animate-spin" : undefined)}
              />
              {model.isRestartPending ? "Restarting..." : "Restart"}
            </Button>
          </div>
        </div>
      </div>

      {model.error ? (
        <div
          className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-testid="agent-studio-dev-server-error-banner"
        >
          {model.error}
        </div>
      ) : null}

      <Tabs
        value={selectedTabsValue}
        onValueChange={model.onSelectScript}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="border-b border-border px-2 py-2">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-md border border-border bg-muted/60 p-1">
            {model.scripts.map((script) => {
              const isScriptActive = script.status !== "stopped";
              return (
                <TabsTrigger
                  key={script.scriptId}
                  value={script.scriptId}
                  className="min-w-0 justify-start rounded-sm border-border bg-transparent px-3 py-2 font-mono text-[11px]"
                  data-testid={`agent-studio-dev-server-tab-${script.scriptId}`}
                >
                  <span
                    className={cn(
                      "mr-2 inline-block size-2 rounded-full",
                      isScriptActive ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{script.name}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {selectedScriptContent ? (
          <TabsContent
            value={selectedScriptContent.scriptId}
            className="min-h-0 flex-1 outline-none"
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{selectedScriptContent.name}</span>
                  <span className="font-mono">{selectedScriptContent.command}</span>
                </div>
              </div>

              <div ref={logViewportContainerRef} className="min-h-0 flex-1">
                <ScrollArea className="h-full min-h-0">
                  {selectedScriptContent.bufferedLogLines.length > 0 ? (
                    <div className="space-y-1 px-3 py-3 font-mono text-[11px] leading-5">
                      {renderedLogLines.map(({ key, logLine }) => (
                        <div
                          key={key}
                          className="flex gap-3"
                          data-testid="agent-studio-dev-server-log-line"
                        >
                          <span className="shrink-0 text-muted-foreground">
                            {formatLogTimestamp(logLine.timestamp)}
                          </span>
                          <span className="shrink-0 text-muted-foreground/80">
                            [{logLine.stream}]
                          </span>
                          <span
                            className={cn(
                              "min-w-0 whitespace-pre-wrap break-words",
                              streamClassName(logLine.stream),
                            )}
                          >
                            {logLine.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className="flex h-full min-h-0 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground"
                      data-testid="agent-studio-dev-server-empty-log-state"
                    >
                      {selectedScriptContent.status === "starting"
                        ? "Starting this dev server..."
                        : selectedScriptContent.status === "failed"
                          ? (selectedScriptContent.lastError ??
                            "This dev server exited before producing logs.")
                          : "Logs will appear here once this dev server writes output."}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      {!hasSelectedScriptLogs && selectedScript?.lastError ? (
        <div className="border-t border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {selectedScript.lastError}
        </div>
      ) : null}
    </div>
  );
});
