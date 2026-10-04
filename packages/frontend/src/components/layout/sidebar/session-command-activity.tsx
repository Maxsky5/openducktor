import type { TerminalActivity } from "@openducktor/contracts";
import { SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionCommands } from "@/features/session-navigation/use-session-commands";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";

export function SessionCommandIcon({ count }: { count: number }): ReactElement | null {
  if (count === 0) return null;
  return (
    <SquareTerminal
      className="size-3.5 shrink-0 text-status-running-foreground"
      role="img"
      aria-label={`${count} active ${count === 1 ? "command" : "commands"}`}
    />
  );
}

export function SessionPreviewCommands({
  entry,
}: {
  entry: SessionNavigationEntry;
}): ReactElement | null {
  const { status, commands, error } = useSessionCommands(entry);
  if (status === "unavailable")
    return (
      <p role="alert" className="text-xs text-warning-muted">
        Command status unavailable: {error}
      </p>
    );
  if (status === "loading")
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Checking commands…
      </p>
    );
  if (commands.length === 0) return null;
  const countLabel = `${commands.length} active ${commands.length === 1 ? "command" : "commands"}`;
  const terminals = commands.filter((command) => command.kind === "terminal");
  const servers = commands.filter((command) => command.kind === "dev_server");
  return (
    <section aria-label="Active commands" className="shrink-0">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 gap-1.5 px-1.5 text-xs tabular-nums text-info-muted hover:bg-info-surface hover:text-info-muted"
              aria-label={countLabel}
            >
              <SquareTerminal
                className="size-3.5 text-status-running-foreground"
                aria-hidden="true"
              />
              {commands.length}
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="start"
            sideOffset={6}
            className="max-h-80 w-80 max-w-[calc(100vw-24px)] overflow-y-auto p-3 text-left"
          >
            <div className="space-y-3">
              <CommandList label="Dev servers" commands={servers} />
              <CommandList label="Terminals" commands={terminals} />
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </section>
  );
}

function CommandList({
  label,
  commands,
}: {
  label: string;
  commands: readonly TerminalActivity[];
}): ReactElement | null {
  if (commands.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium opacity-70">
        {label} · {commands.length}
      </p>
      <ul className="space-y-2">
        {commands.map(({ summary, kind, command }) => (
          <li key={summary.terminalId} className="space-y-0.5">
            {kind === "dev_server" || summary.lifecycle !== "running" ? (
              <div className="flex items-start justify-between gap-3">
                {kind === "dev_server" ? (
                  <span className="min-w-0 break-all text-xs font-medium">{summary.label}</span>
                ) : null}
                {summary.lifecycle !== "running" ? (
                  <span className="shrink-0 text-[10px] opacity-70">
                    {commandLifecycleLabel(summary.lifecycle)}
                  </span>
                ) : null}
              </div>
            ) : null}
            <code className="block break-all font-mono text-[11px] leading-relaxed">{command}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function commandLifecycleLabel(lifecycle: TerminalActivity["summary"]["lifecycle"]): string {
  if (lifecycle === "starting") return "Starting";
  if (lifecycle === "closing") return "Stopping";
  if (lifecycle === "close_failed") return "Stop failed";
  return "Stopped";
}
