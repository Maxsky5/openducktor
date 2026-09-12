import type { DevServerScriptState } from "@openducktor/contracts";
import { Check, Copy, Play, RefreshCw, Square } from "lucide-react";
import {
  cloneElement,
  memo,
  type ReactElement,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import { AgentStudioDevServerTerminal } from "@/components/features/agents/agent-studio-dev-server-terminal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import {
  terminalTabsListClassName,
  terminalTabTriggerClassName,
} from "@/features/terminals/terminal-tab-styles";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import {
  createDevServerTaskScope,
  formatDevServerTaskScopeKey,
} from "@/types/dev-server-task-scope";

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

export const DEV_SERVER_DISABLED_REASON =
  "Create or resume a Builder worktree before starting repository dev servers.";
export const DEV_SERVER_EMPTY_REASON =
  "Configure one or more builder dev server commands in repository settings to stream them here.";

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
    return "Loading dev servers…";
  }

  if (isStartPending) {
    return "Starting dev servers…";
  }

  return "Start dev servers";
};

const getEmptyTerminalMessage = (script: DevServerScriptState): string => {
  if (script.status === "starting") {
    return "Starting this dev server…";
  }

  if (script.status === "failed") {
    return `${script.lastError ?? "This dev server exited before producing terminal output."} Drag to select logs, then press Cmd/Ctrl+C to copy.`;
  }

  return "Terminal output will appear here once this dev server writes output. Drag to select logs, then press Cmd/Ctrl+C to copy.";
};

const getDisplayedScriptCommand = (script: DevServerScriptState): string =>
  script.startedCommand ?? script.command;

const getHeaderSummary = (
  mode: AgentStudioDevServerPanelMode,
  worktreePath: string | null,
): string => {
  if (mode === "empty") {
    return DEV_SERVER_EMPTY_REASON;
  }

  if (mode === "disabled") {
    return DEV_SERVER_DISABLED_REASON;
  }

  if (mode === "loading") {
    return "Loading builder dev server state…";
  }

  if (mode === "stopped") {
    return "Start the configured builder dev servers for this task worktree.";
  }

  return worktreePath
    ? `Running in ${worktreePath}`
    : "Builder dev server terminals stream here while the task worktree is active.";
};

function CompactStartButton({
  button,
  disabledReason,
  disabledReasonId,
}: {
  button: ReactElement<{
    className?: string;
    onClick?: (() => void) | undefined;
    disabled?: boolean | undefined;
    "aria-disabled"?: string;
    "aria-describedby"?: string;
  }>;
  disabledReason: string | null;
  disabledReasonId: string;
}): ReactElement {
  if (!disabledReason) {
    return button;
  }

  const tooltipTriggerButton = cloneElement(button, {
    disabled: undefined,
    onClick: undefined,
    className: cn(button.props.className, "cursor-not-allowed opacity-50"),
    "aria-disabled": "true",
    "aria-describedby": disabledReasonId,
  });

  return (
    <TooltipProvider>
      <span id={disabledReasonId} className="sr-only">
        {disabledReason}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>{tooltipTriggerButton}</TooltipTrigger>
        <TooltipContent side="top">
          <p>{disabledReason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CompactDevServerPanel({
  compactAction,
  disabledReason,
  disabledReasonId,
  isActionPending,
  isStartPending,
  mode,
  onStart,
  panelError,
}: {
  compactAction: ReactElement | undefined;
  disabledReason: string | null;
  disabledReasonId: string;
  isActionPending: boolean;
  isStartPending: boolean;
  mode: AgentStudioDevServerPanelMode;
  onStart: () => void;
  panelError: string | null;
}): ReactElement {
  const isEmpty = mode === "empty";
  const isDisabled = mode === "disabled";
  const isLoading = mode === "loading";
  const startDisabled = isEmpty || isDisabled || isLoading || isActionPending;
  const startLabel = getStartLabel(isLoading, isStartPending);
  const startButton = (
    <Button
      type="button"
      size="sm"
      className="w-full justify-center rounded-lg"
      disabled={startDisabled}
      onClick={onStart}
      data-testid="agent-studio-dev-server-start-button"
    >
      <Play className="size-4" />
      {startLabel}
    </Button>
  );
  // `disabledReason` is only produced for the stable `empty`/`disabled` modes.
  // It cannot overlap with the transient loading/start-pending button labels.

  return (
    <div
      className="border-t border-border bg-card/70 p-3"
      data-testid="agent-studio-dev-server-compact-panel"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <CompactStartButton
            button={startButton}
            disabledReason={disabledReason}
            disabledReasonId={disabledReasonId}
          />
        </div>
        {compactAction}
      </div>
      <DevServerErrorBanner
        className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        message={panelError}
      />
    </div>
  );
}

function DevServerWorktreePathHeader({
  headerSummary,
  isWorktreePathCopied,
  onCopyWorktreePath,
  worktreePath,
}: {
  headerSummary: string;
  isWorktreePathCopied: boolean;
  onCopyWorktreePath: () => void;
  worktreePath: string | null;
}): ReactElement {
  if (worktreePath === null) {
    return (
      <p
        className="mt-3 text-xs text-muted-foreground"
        data-testid="agent-studio-dev-server-header-summary"
      >
        {headerSummary}
      </p>
    );
  }

  return (
    <div className="inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
      <p className="min-w-0 truncate" data-testid="agent-studio-dev-server-header-summary">
        {headerSummary}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onCopyWorktreePath}
        data-testid="agent-studio-dev-server-copy-worktree-path"
        aria-label="Copy working directory"
      >
        {isWorktreePathCopied ? (
          <Check className="size-3.5 text-emerald-500 dark:text-emerald-400" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

function DevServerErrorBanner({
  className,
  message,
}: {
  className: string;
  message: string | null;
}): ReactElement | null {
  if (message === null) {
    return null;
  }

  return (
    <div className={className} data-testid="agent-studio-dev-server-error-banner">
      {message}
    </div>
  );
}

function DevServerTerminalContent({
  onRendererError,
  script,
  terminalBuffer,
  terminalChunkCount,
  terminalScopeKey,
}: {
  onRendererError: (message: string | null) => void;
  script: DevServerScriptState | null;
  terminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  terminalChunkCount: number;
  terminalScopeKey: string;
}): ReactElement | null {
  if (script === null) {
    return null;
  }

  return (
    <TabsContent
      value={script.scriptId}
      className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--dev-server-terminal-panel)] text-[var(--dev-server-terminal-foreground)]">
        <div className="border-b border-[var(--dev-server-terminal-border)] bg-[var(--dev-server-terminal-panel-header)] px-3 py-2 text-xs text-[var(--dev-server-terminal-muted)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[var(--dev-server-terminal-subtle)]">$</span>
            <span className="font-mono text-[var(--dev-server-terminal-foreground)]">
              {getDisplayedScriptCommand(script)}
            </span>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--dev-server-terminal-panel)]">
          <AgentStudioDevServerTerminal
            scopeKey={terminalScopeKey}
            scriptId={script.scriptId}
            terminalBuffer={terminalBuffer}
            onRendererError={onRendererError}
          />
          {terminalChunkCount === 0 ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 py-8 text-center text-sm text-[var(--dev-server-terminal-muted)]"
              data-testid="agent-studio-dev-server-empty-log-state"
            >
              {getEmptyTerminalMessage(script)}
            </div>
          ) : null}
        </div>
      </div>
    </TabsContent>
  );
}

export const AgentStudioDevServerPanel = memo(function AgentStudioDevServerPanel({
  model,
  compactAction,
}: {
  model: AgentStudioDevServerPanelModel;
  compactAction?: ReactElement;
}): ReactElement {
  const [rendererError, setRendererError] = useState<string | null>(null);
  const selectedScript = model.selectedScript;
  const isActionPending = model.isStartPending || model.isStopPending || model.isRestartPending;
  const hasExpandedActions = model.isExpanded;
  const selectedTabsValue = model.selectedScriptId ?? model.scripts[0]?.scriptId ?? "__none__";
  const selectedScriptContent = selectedScript ?? model.scripts[0] ?? null;
  const terminalScopeKey = formatDevServerTaskScopeKey(
    createDevServerTaskScope(model.repoPath, model.taskId),
  );
  const selectedScriptTerminalBuffer = useMemo(() => {
    if (model.selectedScriptTerminalBuffer !== null) {
      return model.selectedScriptTerminalBuffer;
    }
    if (selectedScriptContent === null) {
      return null;
    }

    return {
      entries: selectedScriptContent.bufferedTerminalChunks,
      lastSequence: selectedScriptContent.bufferedTerminalChunks.at(-1)?.sequence ?? null,
      resetToken: 0,
    };
  }, [model.selectedScriptTerminalBuffer, selectedScriptContent]);
  const selectedScriptTerminalChunkCount = selectedScriptTerminalBuffer?.entries.length ?? 0;
  const panelError = model.error ?? rendererError;
  const disabledReasonId = useId();
  const { copied: copiedWorktreePath, copyToClipboard: copyWorktreePath } = useCopyToClipboard({
    getSuccessDescription: (value) => value,
    errorLogContext: "AgentStudioDevServerPanel",
  });

  const headerSummary = useMemo(
    () => getHeaderSummary(model.mode, model.worktreePath),
    [model.mode, model.worktreePath],
  );

  const handleCopyWorktreePath = useCallback(() => {
    if (!model.worktreePath) {
      return;
    }

    void copyWorktreePath(model.worktreePath);
  }, [copyWorktreePath, model.worktreePath]);

  if (!hasExpandedActions) {
    return (
      <CompactDevServerPanel
        compactAction={compactAction}
        disabledReason={model.disabledReason}
        disabledReasonId={disabledReasonId}
        isActionPending={isActionPending}
        isStartPending={model.isStartPending}
        mode={model.mode}
        onStart={model.onStart}
        panelError={panelError}
      />
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
            {model.isStopPending ? "Stopping…" : "Stop"}
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
            {model.isRestartPending ? "Restarting…" : "Restart"}
          </Button>
        </div>

        <DevServerWorktreePathHeader
          headerSummary={headerSummary}
          isWorktreePathCopied={copiedWorktreePath}
          onCopyWorktreePath={handleCopyWorktreePath}
          worktreePath={model.worktreePath}
        />
      </div>

      <DevServerErrorBanner
        className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive"
        message={panelError}
      />

      <Tabs
        value={selectedTabsValue}
        onValueChange={model.onSelectScript}
        className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-(--dev-server-terminal-surface) text-(--dev-server-terminal-foreground)">
          <div className="border-b border-(--dev-server-terminal-border) px-0">
            <TabsList className={terminalTabsListClassName}>
              {model.scripts.map((script) => {
                return (
                  <TabsTrigger
                    key={script.scriptId}
                    value={script.scriptId}
                    className={terminalTabTriggerClassName}
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

          <DevServerTerminalContent
            onRendererError={setRendererError}
            script={selectedScriptContent}
            terminalBuffer={selectedScriptTerminalBuffer}
            terminalChunkCount={selectedScriptTerminalChunkCount}
            terminalScopeKey={terminalScopeKey}
          />
        </div>
      </Tabs>
    </div>
  );
});
