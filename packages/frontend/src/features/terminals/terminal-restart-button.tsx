import type {
  TerminalRestartRequest,
  TerminalRestartResponse,
  TerminalSummary,
} from "@openducktor/contracts";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Loader2, RotateCw, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { terminalActivityOwnerKey } from "./terminal-activity-store";
import type { TerminalTransportController } from "./terminal-transport-controller";

export function TerminalRestartButton({
  summary,
  controller,
  onRestart,
  isVisible = true,
}: {
  isVisible?: boolean;
  summary: TerminalSummary;
  controller: Pick<TerminalTransportController, "readActivity" | "subscribeActivity">;
  onRestart: (request: TerminalRestartRequest) => Promise<TerminalRestartResponse>;
}) {
  const ownerKey = terminalActivityOwnerKey(summary.context);
  const read = useCallback(() => controller.readActivity(ownerKey), [controller, ownerKey]);
  const state = useSyncExternalStore(controller.subscribeActivity, read, read);
  const activity =
    state.status === "ready"
      ? state.commands.find((item) => item.summary.terminalId === summary.terminalId)
      : undefined;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState(activity?.command);

  if (activity?.command !== lastCommand) {
    setLastCommand(activity?.command);
    setError(null);
  }

  const restart = async () => {
    if (!activity?.restartable || pending) return;
    setPending(true);
    setError(null);
    try {
      await onRestart({ terminalId: summary.terminalId, expectedCommand: activity.command });
    } catch (cause) {
      const latest = read();
      const command =
        latest.status === "ready"
          ? latest.commands.find((item) => item.summary.terminalId === summary.terminalId)
          : undefined;
      if (!command || command.command === activity.command) setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  if (!activity?.restartable && !pending && error === null) return null;
  const label = pending ? "Restarting command…" : "Restart command";
  return (
    <Popover
      open={isVisible && error !== null}
      onOpenChange={(open) => {
        if (!open) setError(null);
      }}
    >
      <PopoverAnchor asChild>
        <span hidden={!isVisible} className={isVisible ? "ml-auto inline-flex shrink-0" : "hidden"}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label={label}
                aria-busy={pending}
                disabled={pending || !activity?.restartable || state.status !== "ready"}
                onClick={() => void restart()}
              >
                {pending ? (
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <RotateCw className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="end"
        className="flex w-72 items-start gap-2 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
          {error}
        </p>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="-mt-1 -mr-1 size-6"
          aria-label="Dismiss restart error"
          onClick={() => setError(null)}
        >
          <X className="size-3" aria-hidden="true" />
        </Button>
      </PopoverContent>
    </Popover>
  );
}
