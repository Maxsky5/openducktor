import { Check, LoaderCircle, OctagonAlert } from "lucide-react";
import { type CSSProperties, type ReactElement, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { startupFailureRows } from "@openducktor/frontend-core/sessions/startup/startup-trace";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import {
  canOpenStartupSession,
  startupIsPending,
} from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { StartupRecoveryActions, StartupTrace } from "./session-startup-trace";
import { useOpenStartupSession } from "./use-open-startup-session";
import { retainStartupPresentations, startupPresentation } from "./startup-presentation";
import {
  startupActivity,
  startupIssue,
  startupOrigin,
  startupProgress,
  startupTitle,
} from "./startup-summary";

const startupToasterStyle: CSSProperties & Record<`--${string}`, string> = {
  "--width": "min(24rem, calc(100vw - 2rem))",
  height: "calc(100dvh - 2rem)",
  maxHeight: "calc(100dvh - 2rem)",
  overflowY: "auto",
  pointerEvents: "none",
};

export function StartupNotifications(): ReactElement | null {
  const connection = useClientConnection();
  const toasterId = useId();
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
  if (!notifications.length) return null;
  return (
    <>
      <Toaster
        id={toasterId}
        customAriaLabel="Session startup notifications"
        position="top-right"
        offset={16}
        mobileOffset={16}
        expand
        visibleToasts={notifications.length}
        hotkey={[]}
        style={startupToasterStyle}
        className="overscroll-contain [&>[data-sonner-toast]]:pointer-events-auto"
      />
      {notifications.map((attempt) => (
        <StartupNotice key={attempt.id} attempt={attempt} toasterId={toasterId} />
      ))}
    </>
  );
}

function StartupNotice({
  attempt,
  toasterId,
}: {
  attempt: StartupAttempt;
  toasterId: string;
}): null {
  const connection = useClientConnection();
  const { openSession, openError } = useOpenStartupSession(attempt);
  const [expanded, setExpanded] = useState(() => {
    const presentation = startupPresentation(connection, attempt.id);
    return (
      presentation.detailsOpen ||
      presentation.expandedSteps.size > 0 ||
      presentation.inspection.getSnapshot()
    );
  });
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const measuredHeight = useRef(0);
  useEffect(() => {
    if (!contentElement) return;
    const observer = new ResizeObserver(() => {
      const height = contentElement.getBoundingClientRect().height;
      if (height === measuredHeight.current) return;
      measuredHeight.current = height;
      setContentHeight(height);
    });
    observer.observe(contentElement);
    return () => observer.disconnect();
  }, [contentElement]);
  const toastId = `session-startup:${attempt.id}`;
  useEffect(
    () => () => {
      toast.dismiss(toastId);
    },
    [connection, toastId],
  );
  useEffect(() => {
    const pending = startupIsPending(attempt);
    const activity = startupActivity(attempt);
    const issue = startupIssue(attempt);
    const progress = startupProgress(attempt);
    const hasTrace = progress.total > 0;
    const canInspect =
      hasTrace || attempt.ownership.state === "saved" || startupFailureRows(attempt).length > 0;
    let progressLabel = "View progress";
    if (!hasTrace || attempt.status.phase === "ready") progressLabel = "Details";
    if (expanded) progressLabel = hasTrace ? "Hide progress" : "Hide details";
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
    toast(startupTitle(attempt), {
      id: toastId,
      toasterId,
      duration: Infinity,
      dismissible: !pending,
      closeButton: !pending,
      icon,
      onDismiss: () => connection.startupAttempts.dismiss(attempt.id),
      classNames: {
        toast: "!items-start",
        content: "w-full",
      },
      description: (
        <div ref={setContentElement} className="flex min-w-0 flex-col gap-2">
          <p className="break-words">{startupOrigin(attempt)}</p>
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {activity ? <span>{activity}</span> : null}
            {progress.total > 0 ? (
              <span className="shrink-0 tabular-nums">
                {progress.completed}/{progress.total} steps
              </span>
            ) : null}
          </p>
          {!expanded && attempt.status.confirmation === "unconfirmed" ? (
            <p className="text-warning-surface-foreground">
              Startup is not confirmed. Inspect the session before you try again.
            </p>
          ) : null}
          {!expanded && issue ? (
            <p role="alert" className="break-words text-destructive">
              {issue}
            </p>
          ) : null}
          {expanded && canInspect ? (
            <div
              className={hasTrace ? "max-h-52 min-h-0 overflow-hidden" : "max-h-52 overflow-y-auto"}
            >
              <StartupTrace
                attempt={attempt}
                onOpen={openSession}
                showHeader={false}
                className={hasTrace ? "max-h-52" : ""}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!expanded && canOpenStartupSession(attempt) ? (
              <Button
                type="button"
                size="xs"
                variant={attempt.status.phase === "ready" ? "default" : "outline"}
                onClick={() => void openSession()}
              >
                Open session
              </Button>
            ) : null}
            {canInspect ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-expanded={expanded}
                onClick={() =>
                  setExpanded((currentExpanded) => {
                    const next = !currentExpanded;
                    startupPresentation(connection, attempt.id).detailsOpen = next;
                    return next;
                  })
                }
              >
                {progressLabel}
              </Button>
            ) : null}
          </div>
          {!expanded ? <StartupRecoveryActions attempt={attempt} /> : null}
          {openError ? (
            <p role="alert" className="break-words text-destructive">
              {openError}
            </p>
          ) : null}
        </div>
      ),
    });
  }, [attempt, connection, contentHeight, expanded, openError, openSession, toastId, toasterId]);
  return null;
}
