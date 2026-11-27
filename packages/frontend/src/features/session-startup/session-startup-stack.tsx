import {
  BackgroundOperationNotifications,
  type FinishClosingTask,
} from "./background-operation-notifications";
import { Check, LoaderCircle, OctagonAlert } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { toast } from "sonner";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import {
  startupFailureRows,
  startupStepCounts,
} from "@openducktor/frontend-core/sessions/startup/startup-trace";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import {
  canOpenStartupSession,
  startupIsPending,
} from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { NotificationOpenLabel } from "@/components/ui/sonner";
import { ToastResizeContent } from "@/components/ui/toast-resize";
import { notificationClassNames } from "@/lib/sonner-feedback";
import { cn } from "@/lib/utils";
import { STARTUP_TEXT_INSET } from "./constants";
import { StartupRecoveryActions, StartupTrace } from "./session-startup-trace";
import { TraceIcon } from "@/components/ui/trace";
import { useOpenStartupSession } from "./use-open-startup-session";
import { StartupExpandChevron, StartupStepCounter } from "./startup-card-parts";
import { retainStartupPresentations, startupPresentation } from "./startup-presentation";
import {
  STARTUP_UNCONFIRMED_MESSAGE,
  startupActivity,
  startupIssue,
  startupOrigin,
  startupProgressToggleLabel,
  startupTitle,
} from "./startup-summary";

export function StartupNotifications({
  finishClosingTask,
}: {
  finishClosingTask?: FinishClosingTask | undefined;
}): ReactElement {
  const connection = useClientConnection();
  const { startupAttempts } = connection;
  const attempts = useStartupAttempts();
  useEffect(
    () => retainStartupPresentations(connection, new Set(attempts.map((attempt) => attempt.id))),
    [attempts, connection],
  );
  useEffect(() => {
    const checkExpiry = () => startupAttempts.expireSuccess();
    document.addEventListener("visibilitychange", checkExpiry);
    window.addEventListener("focus", checkExpiry);
    return () => {
      document.removeEventListener("visibilitychange", checkExpiry);
      window.removeEventListener("focus", checkExpiry);
    };
  }, [startupAttempts]);
  const notifications = attempts.filter((attempt) => attempt.presentation === "notification");
  return (
    <>
      <BackgroundOperationNotifications finishClosingTask={finishClosingTask} />
      {notifications.map((attempt) => (
        <StartupNotice key={attempt.id} attempt={attempt} />
      ))}
    </>
  );
}

function StartupNotice({ attempt }: { attempt: StartupAttempt }): null {
  const connection = useClientConnection();
  const { openSession, openError } = useOpenStartupSession(attempt);
  const [detailsOpen, setDetailsOpen] = useState(
    () => startupPresentation(connection, attempt.id).detailsOpen,
  );
  const [contentHeight, setContentHeight] = useState(0);
  const toastId = `session-startup:${attempt.id}`;
  useEffect(
    () => () => {
      toast.dismiss(toastId);
    },
    [toastId],
  );
  useEffect(() => {
    const pending = startupIsPending(attempt);
    const activity = startupActivity(attempt);
    const issue = startupIssue(attempt);
    const progress = startupStepCounts(attempt);
    const hasTrace = progress.total > 0;
    const expanded = detailsOpen ?? hasTrace;
    const canInspect =
      hasTrace || attempt.ownership.state === "saved" || startupFailureRows(attempt).length > 0;
    const progressLabel = startupProgressToggleLabel(expanded, hasTrace, attempt.status.phase);
    let icon = <OctagonAlert aria-hidden="true" className="size-4 text-destructive" />;
    if (pending)
      icon = (
        <LoaderCircle
          aria-hidden="true"
          className="size-4 text-info-surface-foreground motion-safe:animate-spin"
        />
      );
    else if (attempt.status.phase === "ready" && !issue)
      icon = <Check aria-hidden="true" className="size-4 text-success-icon" />;
    const toggleDetails = () => {
      const next = !expanded;
      startupPresentation(connection, attempt.id).detailsOpen = next;
      setDetailsOpen(next);
    };
    const headerContent = (
      <>
        <TraceIcon className="size-5">{icon}</TraceIcon>
        <span className="min-w-0 flex-1 truncate">{startupTitle(attempt)}</span>
        <div className="flex shrink-0 items-center gap-1">
          {hasTrace && (pending || !expanded) ? (
            <StartupStepCounter completed={progress.completed} total={progress.total} />
          ) : null}
          {canInspect ? <StartupExpandChevron expanded={expanded} /> : null}
        </div>
      </>
    );
    toast(
      canInspect ? (
        <button
          type="button"
          className="group/startup-toggle -mx-1.5 -my-1 flex w-[calc(100%+0.75rem)] min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={progressLabel}
          title={progressLabel}
          aria-expanded={expanded}
          onClick={toggleDetails}
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2">{headerContent}</div>
      ),
      {
        id: toastId,
        duration: Infinity,
        dismissible: !pending,
        closeButton: !pending,
        icon: null,
        onDismiss: () => connection.startupAttempts.dismiss(attempt.id),
        classNames: notificationClassNames,
        action: canOpenStartupSession(attempt)
          ? {
              label: <NotificationOpenLabel />,
              onClick: (event) => {
                event.preventDefault();
                void openSession();
              },
            }
          : undefined,
        description: (
          <ToastResizeContent onResize={setContentHeight} className="flex min-w-0 flex-col gap-2">
            {/* Text lines start under the title. Step rows keep their icons under the status icon. */}
            <div className={cn("flex min-w-0 flex-col gap-1", STARTUP_TEXT_INSET)}>
              <p className="break-words">{startupOrigin(attempt)}</p>
              {activity && (!expanded || !hasTrace) ? <p>{activity}</p> : null}
              {!expanded && attempt.status.confirmation === "unconfirmed" ? (
                <p className="text-warning-surface-foreground">{STARTUP_UNCONFIRMED_MESSAGE}</p>
              ) : null}
              {!expanded && issue ? (
                <p role="alert" className="break-words text-destructive">
                  {issue}
                </p>
              ) : null}
            </div>
            {expanded && canInspect ? (
              <div
                className={cn(
                  // The trace rows reach 8px past the text column. Keep that edge inside the clip.
                  "-mx-2 max-h-52 px-2",
                  hasTrace ? "min-h-0 overflow-hidden" : "overflow-y-auto",
                )}
              >
                <StartupTrace
                  attempt={attempt}
                  showHeader={false}
                  className={hasTrace ? "max-h-52" : ""}
                />
              </div>
            ) : null}
            {!expanded ? <StartupRecoveryActions attempt={attempt} /> : null}
            {openError ? (
              <p role="alert" className={cn("break-words text-destructive", STARTUP_TEXT_INSET)}>
                {openError}
              </p>
            ) : null}
          </ToastResizeContent>
        ),
      },
    );
  }, [attempt, connection, contentHeight, detailsOpen, openError, openSession, toastId]);
  return null;
}
