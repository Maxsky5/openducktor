import type { DevServerOwner, DevServerScriptState } from "@openducktor/contracts";
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
import { createDevServerScope, formatDevServerScopeKey } from "@/types/dev-server-scope";

export type AgentStudioDevServerPanelMode =
  | "loading"
  | "error"
  | "empty"
  | "disabled"
  | "stopped"
  | "active";

export type AgentStudioDevServerPanelModel = {
  mode: AgentStudioDevServerPanelMode;
  isExpanded: boolean;
  isLoading: boolean;
  disabledReason: string | null;
  repoPath: string | null;
  owner: DevServerOwner | null;
  workingDirectory: string | null;
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
  "Add dev server scripts in repository settings to run them here.";

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

const getStartLabel = (isStartPending: boolean): string => {
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
  workingDirectory: string | null,
  owner: DevServerOwner | null,
): string => {
  if (mode === "empty") {
    return DEV_SERVER_EMPTY_REASON;
  }

  if (mode === "disabled") {
    return owner?.kind === "workspace_session"
      ? "This Workspace Session directory is unavailable. Restore its worktree or reload the session."
      : DEV_SERVER_DISABLED_REASON;
  }

  if (mode === "loading") {
    return "Loading dev server state…";
  }

  if (mode === "error") {
    return "Could not load dev server state.";
  }

  if (mode === "stopped") {
    return owner?.kind === "workspace_session"
      ? "Start the configured dev servers for this Workspace Session."
      : "Start the configured dev servers for this task worktree.";
  }

  return workingDirectory
    ? `Running in ${workingDirectory}`
    : "Dev server output appears here when the group starts.";
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
  const startDisabled = isEmpty || isDisabled || isLoading || mode === "error" || isActionPending;
  const startLabel = getStartLabel(isStartPending);
  const startButton = (
    <Button
      type="button"
      size="sm"
      className={cn("w-full justify-center rounded-lg", isLoading && "disabled:opacity-100")}
      disabled={startDisabled}
      aria-busy={isLoading}
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

function DevServerWorkingDirectoryHeader({
  headerSummary,
  isWorkingDirectoryCopied,
  onCopyWorkingDirectory,
  workingDirectory,
}: {
  headerSummary: string;
  isWorkingDirectoryCopied: boolean;
  onCopyWorkingDirectory: () => void;
  workingDirectory: string | null;
}): ReactElement {
  if (workingDirectory === null) {
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
        onClick={onCopyWorkingDirectory}
        data-testid="agent-studio-dev-server-copy-worktree-path"
        aria-label="Copy working directory"
      >
        {isWorkingDirectoryCopied ? (
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
  const terminalScopeKey = formatDevServerScopeKey(
    createDevServerScope(model.repoPath, model.owner),
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
      lastDroppedSequence: null,
    };
  }, [model.selectedScriptTerminalBuffer, selectedScriptContent]);
  const selectedScriptTerminalChunkCount = selectedScriptTerminalBuffer?.entries.length ?? 0;
  const panelError = model.error ?? rendererError;
  const disabledReasonId = useId();
  const { copied: copiedWorkingDirectory, copyToClipboard: copyWorkingDirectory } =
    useCopyToClipboard({
      getSuccessDescription: (value) => value,
      errorLogContext: "AgentStudioDevServerPanel",
    });

  const headerSummary = getHeaderSummary(model.mode, model.workingDirectory, model.owner);

  const handleCopyWorkingDirectory = useCallback(() => {
    if (!model.workingDirectory) {
      return;
    }

    void copyWorkingDirectory(model.workingDirectory);
  }, [copyWorkingDirectory, model.workingDirectory]);

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
      aria-busy={model.isLoading}
    >
      <div className="border-b border-border px-3 pt-3 pb-1">
        <DevServerExpandedActions model={model} />

        <DevServerWorkingDirectoryHeader
          headerSummary={headerSummary}
          isWorkingDirectoryCopied={copiedWorkingDirectory}
          onCopyWorkingDirectory={handleCopyWorkingDirectory}
          workingDirectory={model.workingDirectory}
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

function DevServerExpandedActions({
  model,
}: {
  model: AgentStudioDevServerPanelModel;
}): ReactElement {
  const disabled =
    model.isLoading || model.isStartPending || model.isStopPending || model.isRestartPending;
  const className = cn(
    "h-7 w-full justify-center gap-2 rounded-md px-3 text-sm",
    model.isLoading && "disabled:opacity-100",
  );
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className={className}
        disabled={disabled}
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
        className={className}
        disabled={disabled}
        onClick={model.onRestart}
        data-testid="agent-studio-dev-server-restart-button"
      >
        <RefreshCw className={cn("size-4", model.isRestartPending ? "animate-spin" : undefined)} />
        {model.isRestartPending ? "Restarting…" : "Restart"}
      </Button>
    </div>
  );
}
