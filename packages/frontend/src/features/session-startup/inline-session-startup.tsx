import type { BuiltinRoleId as AgentRole } from "@openducktor/workflows";
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { Button } from "@/components/ui/button";
import { LoaderCircle, OctagonAlert, X } from "lucide-react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { startupPresentation } from "./startup-presentation";
import { startupActivity, startupCurrentStep, startupIssue, startupTitle } from "./startup-summary";
import { useOpenStartupSession } from "./use-open-startup-session";
import { StartupTrace } from "./session-startup-trace";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";

export function InlineStartup({
  repoPath,
  taskId,
  role,
}: {
  repoPath: string | null;
  taskId: string | null | undefined;
  role: AgentRole | null;
}): ReactElement | null {
  return (
    <InlineStartupOwner
      key={JSON.stringify([repoPath, taskId, role])}
      repoPath={repoPath}
      taskId={taskId}
      role={role}
    />
  );
}

function InlineStartupOwner({
  repoPath,
  taskId,
  role,
}: {
  repoPath: string | null;
  taskId: string | null | undefined;
  role: AgentRole | null;
}): ReactElement | null {
  const connection = useClientConnection();
  const attempts = useStartupAttempts();
  const active = useSessionViewActive();
  const matching = attempts.filter(
    (attempt) =>
      attempt.presentation === "inline" &&
      attempt.origin.repoPath === repoPath &&
      attempt.origin.scope.kind === "task" &&
      attempt.origin.scope.taskId === taskId &&
      attempt.origin.scope.role === role,
  );
  const owned = useRef(new Set<string>()).current;
  for (const attempt of matching) owned.add(attempt.id);
  useEffect(() => {
    if (!active) {
      for (const id of owned) connection.startupAttempts.continueInBackground(id);
      owned.clear();
    }
  }, [active, connection, owned]);
  useEffect(
    () => () => {
      for (const id of owned) {
        if (connection.startupAttempts.getAttempt(id)?.presentation === "inline")
          connection.startupAttempts.continueInBackground(id);
      }
      owned.clear();
    },
    [connection, owned],
  );
  useLayoutEffect(() => {
    if (!active) return;
    for (const attempt of matching)
      if (
        attempt.status.phase === "ready" &&
        !attempt.error &&
        !startupCurrentStep(attempt) &&
        connection.startupAttempts.isReadyForHandoff(attempt.id)
      )
        connection.startupAttempts.handoff(attempt.id);
  }, [active, connection, matching]);
  if (!active || !matching.length) return null;
  return (
    <div className="shrink-0 border-b border-border bg-card px-4 py-2">
      {matching.map((attempt) => (
        <InlineProgress key={attempt.id} attempt={attempt} />
      ))}
    </div>
  );
}

function InlineProgress({ attempt }: { attempt: StartupAttempt }): ReactElement {
  const connection = useClientConnection();
  const presentation = startupPresentation(connection, attempt.id);
  const [expanded, setExpanded] = useState(
    () => presentation.detailsOpen || presentation.expandedSteps.size > 0,
  );
  const pending = startupIsPending(attempt);
  const activity = startupActivity(attempt);
  const issue = startupIssue(attempt);
  return (
    <TraceCollapsible
      open={expanded}
      onOpenChange={(open) => {
        presentation.detailsOpen = open;
        setExpanded(open);
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <TraceCollapsibleTrigger
          className="min-h-8 flex-1"
          aria-label={`${startupTitle(attempt)}. ${activity ? `${activity}. ` : ""}${expanded ? "Hide" : "View"} progress`}
        >
          <TraceLine className="min-w-0 w-full text-xs">
            <TraceIcon>
              {pending ? (
                <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <OctagonAlert className="size-3.5 text-warning-surface-foreground" />
              )}
            </TraceIcon>
            <TraceTitle role="status" aria-live="polite" aria-atomic="true" className="text-xs">
              {activity ?? startupTitle(attempt)}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        {!pending ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Dismiss session startup"
            onClick={() => connection.startupAttempts.dismiss(attempt.id)}
          >
            <X />
          </Button>
        ) : null}
      </div>
      {!expanded && issue ? (
        <p role="alert" className="mt-1 line-clamp-2 text-xs text-destructive">
          {issue}
        </p>
      ) : null}
      <TraceCollapsibleContent className="m-0 border-0 p-0">
        <InlineDetails attempt={attempt} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function InlineDetails({ attempt }: { attempt: StartupAttempt }): ReactElement {
  const { openSession, openError } = useOpenStartupSession(attempt);
  return (
    <>
      <StartupTrace
        attempt={attempt}
        onOpen={openSession}
        showHeader={false}
        className="h-56 py-2"
      />
      {openError ? (
        <p role="alert" className="text-xs text-destructive">
          {openError}
        </p>
      ) : null}
    </>
  );
}
