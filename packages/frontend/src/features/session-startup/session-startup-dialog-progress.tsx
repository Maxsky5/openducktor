import { type ReactElement, useEffect, useRef } from "react";
import { Layers, Pencil, RefreshCw } from "lucide-react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { StartupTrace } from "./session-startup-trace";
import { useStartupDialogAttempt } from "./use-startup-dialog-attempt";
import { useOpenStartupSession } from "./use-open-startup-session";

type StartupDialogActions = {
  onClose: () => void;
  onContinueInBackground?: (() => void) | undefined;
  onEditChoices?: (() => void) | undefined;
  onRepairSavedSession?: (() => void) | undefined;
};

export function StartupDialogProgress({
  startupAttemptId,
  open,
  ...actions
}: StartupDialogActions & {
  startupAttemptId: string;
  open: boolean;
}): ReactElement {
  const { attempt, hasFailed } = useStartupDialogAttempt(startupAttemptId);
  return (
    <>
      <DialogBody className="flex min-h-0 flex-col overflow-hidden px-4 py-3">
        <Trace
          attempt={attempt}
          openAfterRecovery={shouldOpenRecoveredTask(attempt, open, hasFailed)}
        />
      </DialogBody>
      <Footer attempt={attempt} {...actions} />
    </>
  );
}

function Trace({
  attempt,
  openAfterRecovery,
}: {
  attempt: StartupAttempt | null;
  openAfterRecovery: boolean;
}): ReactElement {
  if (!attempt)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Submitting request
      </p>
    );
  if (attempt.navigationTarget)
    return <SavedSessionTrace attempt={attempt} openAfterRecovery={openAfterRecovery} />;
  return <StartupTrace attempt={attempt} className="min-h-0 flex-1" />;
}

function SavedSessionTrace({
  attempt,
  openAfterRecovery,
}: {
  attempt: StartupAttempt;
  openAfterRecovery: boolean;
}): ReactElement {
  const connection = useClientConnection();
  const { openSession, openError } = useOpenStartupSession(attempt);
  const triedOpen = useRef(false);
  useEffect(() => {
    if (!connection.startupAttempts.isReadyForHandoff(attempt.id)) {
      triedOpen.current = false;
      return;
    }
    if (!openAfterRecovery || triedOpen.current) return;
    triedOpen.current = true;
    void openSession();
  }, [attempt.id, connection, openAfterRecovery, openSession]);
  return (
    <>
      <StartupTrace attempt={attempt} onOpen={openSession} className="min-h-0 flex-1" />
      {openError ? (
        <p role="alert" className="mt-3 break-words text-sm text-destructive">
          {openError}
        </p>
      ) : null}
    </>
  );
}

function Footer({
  attempt,
  onClose,
  onContinueInBackground,
  onEditChoices,
  onRepairSavedSession,
}: StartupDialogActions & { attempt: StartupAttempt | null }): ReactElement | null {
  const pending = !attempt || startupIsPending(attempt);
  if (pending) {
    if (!onContinueInBackground) return null;
    return (
      <DialogFooter className="mt-0 min-h-13 items-center justify-end border-t border-border px-4 py-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="self-end sm:self-auto"
          onClick={onContinueInBackground}
        >
          <Layers data-icon="inline-start" />
          Continue in background
        </Button>
      </DialogFooter>
    );
  }
  return (
    <DialogFooter className="mt-0 min-h-13 items-center justify-between border-t border-border px-4 py-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start sm:self-auto"
        onClick={onClose}
      >
        Close
      </Button>
      <div className="flex flex-col items-start gap-2 self-end sm:flex-row sm:items-center sm:self-auto">
        {onEditChoices && attempt?.ownership.state === "not_saved" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onEditChoices}>
            <Pencil data-icon="inline-start" />
            Edit choices
          </Button>
        ) : null}
        {onRepairSavedSession && canRepairSavedWorkspace(attempt) ? (
          <Button type="button" size="sm" variant="secondary" onClick={onRepairSavedSession}>
            <RefreshCw data-icon="inline-start" />
            Retry session preparation
          </Button>
        ) : null}
      </div>
    </DialogFooter>
  );
}

function shouldOpenRecoveredTask(
  attempt: StartupAttempt | null,
  open: boolean,
  hasFailed: boolean,
): boolean {
  return (
    open && hasFailed && attempt?.presentation === "dialog" && attempt.origin.scope.kind === "task"
  );
}

function canRepairSavedWorkspace(attempt: StartupAttempt | null): boolean {
  return (
    attempt?.status.phase === "failed" &&
    attempt.ownership.state === "saved" &&
    attempt.ownership.target.kind === "workspace"
  );
}
