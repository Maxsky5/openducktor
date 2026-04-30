import { Activity, ChevronRight, CircleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { AgentActivitySessionItem } from "./agent-activity-model";

type AgentActivityCardProps = {
  activeSessionCount: number;
  waitingForInputCount: number;
  activeSessions: AgentActivitySessionItem[];
  waitingForInputSessions: AgentActivitySessionItem[];
};

const toSessionHref = (session: AgentActivitySessionItem): string => {
  const params = new URLSearchParams({
    task: session.taskId,
    session: session.externalSessionId,
    agent: session.role,
    scenario: session.scenario,
  });
  return `/agents?${params.toString()}`;
};

function SessionList({
  sessions,
  accentClassName,
}: {
  sessions: AgentActivitySessionItem[];
  accentClassName: string;
}): ReactElement {
  return (
    <ul className="mt-1 space-y-1 border-t border-border pt-2">
      {sessions.map((session) => (
        <li key={session.externalSessionId}>
          <Link
            to={toSessionHref(session)}
            className="block rounded-md border border-border bg-card px-2 py-1.5 hover:border-input hover:bg-accent"
          >
            <p className="truncate text-xs font-medium text-foreground">{session.taskTitle}</p>
            <p className={`truncate text-[11px] ${accentClassName}`}>
              {session.role.toUpperCase()} · {session.status}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActivitySection({
  label,
  count,
  icon,
  iconClassName,
  badgeClassName,
  sessions,
  accentClassName,
}: {
  label: string;
  count: number;
  icon: ReactElement;
  iconClassName: string;
  badgeClassName: string;
  sessions: AgentActivitySessionItem[];
  accentClassName: string;
}): ReactElement {
  if (count === 0) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className={iconClassName}>{icon}</span>
          <span>{label}</span>
        </div>
        <span className={badgeClassName}>{count}</span>
      </div>
    );
  }

  return (
    <details className="group rounded-md border border-border bg-card px-2.5 py-2 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex list-none cursor-pointer items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className={iconClassName}>{icon}</span>
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={badgeClassName}>{count}</span>
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        </div>
      </summary>
      <SessionList sessions={sessions} accentClassName={accentClassName} />
    </details>
  );
}

export function AgentActivityCard({
  activeSessionCount,
  waitingForInputCount,
  activeSessions,
  waitingForInputSessions,
}: AgentActivityCardProps): ReactElement {
  const hasWaitingInput = waitingForInputCount > 0;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted p-3 text-xs">
      <div className="flex items-center gap-2 text-foreground">
        <Activity className="size-3.5 text-info-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">Agent Activity</span>
      </div>

      <div className="space-y-2">
        <ActivitySection
          label="Active sessions"
          count={activeSessionCount}
          icon={<Activity className="size-3.5 text-info-accent" />}
          iconClassName="inline-flex"
          badgeClassName="rounded-full bg-info-surface px-2 py-0.5 font-semibold text-info-muted"
          sessions={activeSessions}
          accentClassName="text-info-muted"
        />
        <ActivitySection
          label="Needs your input"
          count={waitingForInputCount}
          icon={
            <CircleAlert
              className={
                hasWaitingInput ? "size-3.5 text-warning-accent" : "size-3.5 text-muted-foreground"
              }
            />
          }
          iconClassName="inline-flex"
          badgeClassName={
            hasWaitingInput
              ? "rounded-full bg-warning-surface px-2 py-0.5 font-semibold text-warning-muted"
              : "rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground"
          }
          sessions={waitingForInputSessions}
          accentClassName={hasWaitingInput ? "text-warning-muted" : "text-muted-foreground"}
        />
      </div>
    </div>
  );
}
