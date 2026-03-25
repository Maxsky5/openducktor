import type { DevServerScriptState } from "@openducktor/contracts";
import { Check, Copy, Play, RefreshCw, Square } from "lucide-react";
import {
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AgentStudioDevServerLogBuffer,
  AgentStudioDevServerLogEntry,
} from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import { getDevServerLogEntryAt } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
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
  selectedScriptLogBuffer: AgentStudioDevServerLogBuffer | null;
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
    return "text-[var(--dev-server-terminal-stderr)]";
  }

  if (stream === "system") {
    return "text-[var(--dev-server-terminal-system)]";
  }

  return "text-[var(--dev-server-terminal-foreground)]";
};

const getClipboardErrorMessage = (error: unknown): string => {
  if (!(error instanceof DOMException)) {
    return "Copy failed";
  }

  switch (error.name) {
    case "NotAllowedError":
      return "Permission denied: clipboard access not allowed";
    case "NotFoundError":
      return "No clipboard available in this environment";
    case "AbortError":
      return "Copy operation was cancelled";
    default:
      return `Copy failed: ${error.message}`;
  }
};

const statusIndicatorClassName = (status: DevServerScriptState["status"]): string => {
  if (status === "running") {
    return "bg-emerald-400";
  }

  if (status === "starting" || status === "stopping") {
    return "bg-amber-400";
  }

  if (status === "failed") {
    return "bg-rose-400";
  }

  return "bg-[var(--dev-server-terminal-dot-stopped)]";
};

const getStartLabel = (isLoading: boolean, isStartPending: boolean): string => {
  if (isLoading) {
    return "Loading dev servers...";
  }

  if (isStartPending) {
    return "Starting dev servers...";
  }

  return "Start dev servers";
};

const getEmptyLogMessage = (script: DevServerScriptState): string => {
  if (script.status === "starting") {
    return "Starting this dev server...";
  }

  if (script.status === "failed") {
    return script.lastError ?? "This dev server exited before producing logs.";
  }

  return "Logs will appear here once this dev server writes output.";
};

const AgentStudioDevServerLogRow = memo(function AgentStudioDevServerLogRow({
  logLine,
}: {
  logLine: AgentStudioDevServerLogEntry;
}): ReactElement {
  return (
    <div
      className="flex gap-3 [content-visibility:auto] [contain-intrinsic-size:20px]"
      data-testid="agent-studio-dev-server-log-line"
    >
      <span className="shrink-0 text-[var(--dev-server-terminal-subtle)]">
        {formatLogTimestamp(logLine.timestamp)}
      </span>
      <span className="shrink-0 text-[var(--dev-server-terminal-muted)]">[{logLine.stream}]</span>
      <span
        className={cn("min-w-0 whitespace-pre-wrap break-words", streamClassName(logLine.stream))}
      >
        {logLine.text}
      </span>
    </div>
  );
});

const AgentStudioDevServerLogList = memo(function AgentStudioDevServerLogList({
  logBuffer,
}: {
  logBuffer: AgentStudioDevServerLogBuffer;
}): ReactElement {
  const logRows = useMemo(() => {
    const rows: ReactElement[] = [];

    for (let offset = 0; offset < logBuffer.entries.length; offset += 1) {
      const logLine = getDevServerLogEntryAt(logBuffer, offset);
      if (!logLine) {
        continue;
      }

      rows.push(<AgentStudioDevServerLogRow key={logLine.id} logLine={logLine} />);
    }

    return rows;
  }, [logBuffer]);

  return <div className="space-y-1 px-4 py-4 font-mono text-[11px] leading-5">{logRows}</div>;
});

export const AgentStudioDevServerPanel = memo(function AgentStudioDevServerPanel({
  model,
}: {
  model: AgentStudioDevServerPanelModel;
}): ReactElement {
  const logViewportContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [logViewport, setLogViewport] = useState<HTMLElement | null>(null);
  const [copiedWorktreePath, setCopiedWorktreePath] = useState(false);
  const selectedScript = model.selectedScript;
  const isActionPending = model.isStartPending || model.isStopPending || model.isRestartPending;
  const hasExpandedActions = model.mode === "active";
  const selectedTabsValue = model.selectedScriptId ?? model.scripts[0]?.scriptId ?? "__none__";
  const selectedScriptContent = selectedScript ?? model.scripts[0] ?? null;
  const selectedScriptLogBuffer = model.selectedScriptLogBuffer;
  const selectedScriptLogCount = selectedScriptLogBuffer?.entries.length ?? 0;

  useEffect(() => {
    if (!copiedWorktreePath) {
      return;
    }

    const timeoutId = setTimeout(() => setCopiedWorktreePath(false), 2000);
    return () => clearTimeout(timeoutId);
  }, [copiedWorktreePath]);

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
    logViewport.addEventListener("scroll", updateAutoScroll, { passive: true });
    return () => {
      logViewport.removeEventListener("scroll", updateAutoScroll);
    };
  }, [logViewport]);

  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return;
    }

    if (selectedTabsValue === "__none__" || !logViewport) {
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

  const handleCopyWorktreePath = useCallback(() => {
    if (!model.worktreePath) {
      return;
    }

    navigator.clipboard
      .writeText(model.worktreePath)
      .then(() => {
        setCopiedWorktreePath(true);
        toast.success("Copied!", { description: model.worktreePath });
      })
      .catch((error: unknown) => {
        console.error("[AgentStudioDevServerPanel] Clipboard write failed:", error);
        toast.error(getClipboardErrorMessage(error));
      });
  }, [model.worktreePath]);

  if (!hasExpandedActions) {
    const isEmpty = model.mode === "empty";
    const isDisabled = model.mode === "disabled";
    const isLoading = model.mode === "loading";
    const startDisabled = isEmpty || isDisabled || isLoading || isActionPending;
    const showCompactMessage = model.mode !== "stopped";
    const startLabel = getStartLabel(isLoading, model.isStartPending);

    return (
      <div
        className="border-t border-border bg-card/70 px-3 py-3"
        data-testid="agent-studio-dev-server-compact-panel"
      >
        <div className="flex items-center">
          <Button
            type="button"
            size="sm"
            className="w-full justify-center rounded-lg"
            disabled={startDisabled}
            onClick={model.onStart}
            data-testid="agent-studio-dev-server-start-button"
          >
            <Play className="size-4" />
            {startLabel}
          </Button>
        </div>
        {showCompactMessage ? (
          <div
            className="mt-3 text-sm text-muted-foreground"
            data-testid="agent-studio-dev-server-compact-message"
          >
            {headerSummary}
          </div>
        ) : null}
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
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7 w-full justify-center gap-2 rounded-md px-3 text-sm"
            disabled={isActionPending}
            onClick={model.onStop}
            data-testid="agent-studio-dev-server-stop-button"
          >
            <Square className="size-3.5 fill-current" />
            {model.isStopPending ? "Stopping..." : "Stop"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 w-full justify-center gap-2 rounded-md px-3 text-sm"
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

        {model.worktreePath ? (
          <div className="mt-3 inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
            <p className="min-w-0 truncate" data-testid="agent-studio-dev-server-header-summary">
              {headerSummary}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={handleCopyWorktreePath}
              data-testid="agent-studio-dev-server-copy-worktree-path"
              aria-label="Copy working directory"
            >
              {copiedWorktreePath ? (
                <Check className="size-3.5 text-emerald-500 dark:text-emerald-400" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        ) : (
          <p
            className="mt-3 text-xs text-muted-foreground"
            data-testid="agent-studio-dev-server-header-summary"
          >
            {headerSummary}
          </p>
        )}
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
        className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--dev-server-terminal-surface)] text-[var(--dev-server-terminal-foreground)]">
          <div className="border-b border-[var(--dev-server-terminal-border)] bg-[var(--dev-server-terminal-chrome)] px-0">
            <TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-0 bg-transparent p-0">
              {model.scripts.map((script) => {
                return (
                  <TabsTrigger
                    key={script.scriptId}
                    value={script.scriptId}
                    className="h-9 w-auto max-w-[320px] flex-none justify-start rounded-none border-r border-t-2 border-r-[var(--dev-server-terminal-border)] border-t-transparent bg-[var(--dev-server-terminal-chrome)] px-3 py-1.5 font-mono text-[11px] text-[var(--dev-server-terminal-muted)] data-[state=active]:border-t-primary data-[state=active]:bg-[var(--dev-server-terminal-tab-active)] data-[state=active]:text-[var(--dev-server-terminal-foreground)]"
                    data-testid={`agent-studio-dev-server-tab-${script.scriptId}`}
                  >
                    <span className="mr-2 font-mono text-[11px] text-[var(--dev-server-terminal-subtle)]">
                      &gt;_
                    </span>
                    <span className="truncate">{script.name}</span>
                    <span
                      className={cn(
                        "ml-2 inline-block size-2 rounded-full",
                        statusIndicatorClassName(script.status),
                      )}
                      aria-hidden="true"
                    />
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {selectedScriptContent ? (
            <TabsContent
              value={selectedScriptContent.scriptId}
              className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--dev-server-terminal-panel)] text-[var(--dev-server-terminal-foreground)]">
                <div className="border-b border-[var(--dev-server-terminal-border)] bg-[var(--dev-server-terminal-panel-header)] px-3 py-2 text-xs text-[var(--dev-server-terminal-muted)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[var(--dev-server-terminal-subtle)]">$</span>
                    <span className="font-mono text-[var(--dev-server-terminal-foreground)]">
                      {selectedScriptContent.command}
                    </span>
                  </div>
                </div>

                <div ref={logViewportContainerRef} className="min-h-0 flex-1 overflow-hidden">
                  <ScrollArea className="h-full min-h-0 bg-[var(--dev-server-terminal-panel)]">
                    {selectedScriptLogCount > 0 && selectedScriptLogBuffer ? (
                      <AgentStudioDevServerLogList logBuffer={selectedScriptLogBuffer} />
                    ) : (
                      <div
                        className="flex h-full min-h-0 items-center justify-center px-6 py-8 text-center text-sm text-[var(--dev-server-terminal-muted)]"
                        data-testid="agent-studio-dev-server-empty-log-state"
                      >
                        {getEmptyLogMessage(selectedScriptContent)}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>
          ) : null}
        </div>
      </Tabs>
    </div>
  );
});
