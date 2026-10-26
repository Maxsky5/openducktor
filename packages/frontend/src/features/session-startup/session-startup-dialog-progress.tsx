import { type ReactElement, useEffect, useEffectEvent, useRef } from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { SessionStartupTrace } from "./session-startup-trace";
import { useStartupDialogAttempt } from "./use-startup-dialog-attempt";
import { useOpenStartupSession } from "./use-open-startup-session";

type StartupDialogActions = {
  onClose: () => void;
  onContinueInBackground?: (() => void) | undefined;
  onEditChoices?: (() => void) | undefined;
  onRepairSavedSession?: (() => void) | undefined;
};

export function SessionStartupProgressContent({
  startupAttemptId,
  open,
  ...actions
}: StartupDialogActions & {
  startupAttemptId: string;
  open: boolean;
}): ReactElement {
  const { attempt, released, hasFailed } = useStartupDialogAttempt(startupAttemptId);
  const closeDialog = useEffectEvent(actions.onClose);
  const transferred = attempt?.presentation === "notification";
  useEffect(() => {
    if (open && (released || transferred)) closeDialog();
  }, [open, released, transferred]);
  return (
    <>
      <DialogBody className="flex min-h-0 flex-col overflow-hidden px-6 py-5">
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
  return <SessionStartupTrace attempt={attempt} className="min-h-0 flex-1" />;
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
      <SessionStartupTrace attempt={attempt} onOpen={openSession} className="min-h-0 flex-1" />
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
}: StartupDialogActions & { attempt: StartupAttempt | null }): ReactElement {
  const pending = !attempt || startupIsPending(attempt);
  if (pending)
    return (
      <DialogFooter className="mt-0 min-h-20 items-center justify-between border-t border-border px-6 py-4 sm:justify-between">
        <p className="text-xs text-muted-foreground">
          You can follow command output in the step details.
        </p>
        {onContinueInBackground ? (
          <Button type="button" variant="secondary" onClick={onContinueInBackground}>
            Continue in background
          </Button>
        ) : null}
      </DialogFooter>
    );
  return (
    <DialogFooter className="mt-0 min-h-20 items-center justify-between border-t border-border px-6 py-4 sm:justify-between">
      <Button type="button" variant="outline" onClick={onClose}>
        Close
      </Button>
      {onEditChoices && attempt?.ownership.state === "not_saved" ? (
        <Button type="button" variant="secondary" onClick={onEditChoices}>
          Edit choices
        </Button>
      ) : null}
      {onRepairSavedSession && canRepairSavedWorkspace(attempt) ? (
        <Button type="button" variant="secondary" onClick={onRepairSavedSession}>
          Retry session preparation
        </Button>
      ) : null}
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
