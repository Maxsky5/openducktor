import type { DevServerScriptState } from "@openducktor/contracts";
import { Check, Copy, Play, RefreshCw, Square } from "lucide-react";
import { memo, type ReactElement, useCallback, useMemo, useState } from "react";
import { AgentStudioDevServerTerminal } from "@/components/features/agents/agent-studio-dev-server-terminal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

export type AgentStudioDevServerPanelMode = "loading" | "empty" | "disabled" | "stopped" | "active";

export type AgentStudioDevServerPanelModel = {
  mode: AgentStudioDevServerPanelMode;
  isExpanded: boolean;
  isLoading: boolean;
  disabledReason: string | null;
  repoPath: string | null;
  taskId: string | null;
  worktreePath: string | null;
  scripts: DevServerScriptState[];
  selectedScriptId: string | null;
  selectedScript: DevServerScriptState | null;
  selectedScriptTerminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  error: string | null;
  isStartPending: boolean;
  isStopPending: boolean;
  isRestartPending: boolean;
  onSelectScript: (scriptId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
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

const getEmptyTerminalMessage = (script: DevServerScriptState): string => {
  if (script.status === "starting") {
    return "Starting this dev server...";
  }

  if (script.status === "failed") {
    return `${script.lastError ?? "This dev server exited before producing terminal output."} Drag to select logs, then press Cmd/Ctrl+C to copy.`;
  }

  return "Terminal output will appear here once this dev server writes output. Drag to select logs, then press Cmd/Ctrl+C to copy.";
};

export const AgentStudioDevServerPanel = memo(function AgentStudioDevServerPanel({
  model,
}: {
  model: AgentStudioDevServerPanelModel;
}): ReactElement {
  const [rendererError, setRendererError] = useState<string | null>(null);
  const selectedScript = model.selectedScript;
  const isActionPending = model.isStartPending || model.isStopPending || model.isRestartPending;
  const hasExpandedActions = model.isExpanded;
  const selectedTabsValue = model.selectedScriptId ?? model.scripts[0]?.scriptId ?? "__none__";
  const selectedScriptContent = selectedScript ?? model.scripts[0] ?? null;
  const selectedScriptTerminalBuffer =
    model.selectedScriptTerminalBuffer ??
    (selectedScriptContent
      ? {
          entries: selectedScriptContent.bufferedTerminalChunks,
          lastSequence: selectedScriptContent.bufferedTerminalChunks.at(-1)?.sequence ?? null,
          resetToken: 0,
        }
      : null);
  const selectedScriptTerminalChunkCount = selectedScriptTerminalBuffer?.entries.length ?? 0;
  const panelError = model.error ?? rendererError;
  const { copied: copiedWorktreePath, copyToClipboard: copyWorktreePath } = useCopyToClipboard({
    getSuccessDescription: (value) => value,
    errorLogContext: "AgentStudioDevServerPanel",
  });

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
      : "Builder dev server terminals stream here while the task worktree is active.";
  }, [model.mode, model.worktreePath]);

  const handleCopyWorktreePath = useCallback(() => {
    if (!model.worktreePath) {
      return;
    }

    void copyWorktreePath(model.worktreePath);
  }, [copyWorktreePath, model.worktreePath]);

  if (!hasExpandedActions) {
    const isEmpty = model.mode === "empty";
    const isDisabled = model.mode === "disabled";
    const isLoading = model.mode === "loading";
    const startDisabled = isEmpty || isDisabled || isLoading || isActionPending;
    const startLabel = getStartLabel(isLoading, model.isStartPending);
    const startButton = (
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
    );

    return (
      <div
        className="border-t border-border bg-card/70 px-3 py-3"
        data-testid="agent-studio-dev-server-compact-panel"
      >
        <div className="flex items-center">
          {model.disabledReason ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex w-full cursor-not-allowed"
                    data-testid="agent-studio-dev-server-disabled-start-trigger"
                  >
                    {startButton}
                    <span className="sr-only">{model.disabledReason}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{model.disabledReason}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            startButton
          )}
        </div>
        {panelError ? (
          <div
            className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="agent-studio-dev-server-error-banner"
          >
            {panelError}
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
      <div className="border-b border-border px-3 pt-3 pb-1">
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
          <div className="inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
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

      {panelError ? (
        <div
          className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-testid="agent-studio-dev-server-error-banner"
        >
          {panelError}
        </div>
      ) : null}

      <Tabs
        value={selectedTabsValue}
        onValueChange={model.onSelectScript}
        className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-(--dev-server-terminal-surface) text-(--dev-server-terminal-foreground)">
          <div className="border-b border-(--dev-server-terminal-border) px-0">
            <TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-0 bg-transparent p-0">
              {model.scripts.map((script) => {
                return (
                  <TabsTrigger
                    key={script.scriptId}
                    value={script.scriptId}
                    className="h-8 w-auto max-w-[320px] flex-none justify-start rounded-none border-b-0 border-l-0 border-r border-t-4 bg-(--dev-server-terminal-tab-inactive) border-r-(--dev-server-terminal-border) border-t-transparent px-3 py-1 font-mono text-[11px] text-(--dev-server-terminal-muted) data-[state=active]:border-t-primary data-[state=active]:bg-(--dev-server-terminal-tab-active) data-[state=active]:border-r-(--dev-server-terminal-border) data-[state=active]:text-(--dev-server-terminal-foreground)"
                    data-testid={`agent-studio-dev-server-tab-${script.scriptId}`}
                  >
                    <span className="mr-2 font-mono text-[11px] text-(--dev-server-terminal-subtle)">
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

                <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--dev-server-terminal-panel)]">
                  <AgentStudioDevServerTerminal
                    scriptId={selectedScriptContent.scriptId}
                    terminalBuffer={selectedScriptTerminalBuffer}
                    onRendererError={setRendererError}
                  />
                  {selectedScriptTerminalChunkCount === 0 ? (
                    <div
                      className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 py-8 text-center text-sm text-[var(--dev-server-terminal-muted)]"
                      data-testid="agent-studio-dev-server-empty-log-state"
                    >
                      {getEmptyTerminalMessage(selectedScriptContent)}
                    </div>
                  ) : null}
                </div>
              </div>
            </TabsContent>
          ) : null}
        </div>
      </Tabs>
    </div>
  );
});
