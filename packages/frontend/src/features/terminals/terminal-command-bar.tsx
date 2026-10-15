import type {
  TerminalRestartRequest,
  TerminalRestartResponse,
  TerminalSummary,
} from "@openducktor/contracts";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { terminalActivityOwnerKey } from "./terminal-activity-store";
import type { TerminalTransportController } from "./terminal-transport-controller";

export function TerminalCommandBar({
  summary,
  controller,
  onRestart,
}: {
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
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {
    if (!activity?.restartable || pendingCommand !== null) return;
    setPendingCommand(activity.command);
    setError(null);
    try {
      await onRestart({ terminalId: summary.terminalId, expectedCommand: activity.command });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPendingCommand(null);
    }
  };

  if (!activity && pendingCommand === null && error === null) return null;
  return (
    <div className="shrink-0 border-t border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <code className="min-w-0 flex-1 truncate" title={pendingCommand ?? activity?.command}>
          {pendingCommand ?? activity?.command}
        </code>
        {activity?.restartable || pendingCommand !== null ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={pendingCommand !== null || state.status !== "ready"}
            onClick={() => void restart()}
            title="Send Ctrl+C, then rerun the command when the shell is ready"
          >
            {pendingCommand === null ? "Restart" : "Restarting…"}
          </Button>
        ) : null}
      </div>
      {error !== null ? (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
