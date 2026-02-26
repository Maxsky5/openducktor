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
    session: session.sessionId,
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
    <ul className="mt-1 space-y-1 border-t border-slate-200 pt-2">
      {sessions.map((session) => (
        <li key={session.sessionId}>
          <Link
            to={toSessionHref(session)}
            className="block rounded-md border border-slate-200 bg-white px-2 py-1.5 hover:border-slate-300 hover:bg-slate-50"
          >
            <p className="truncate text-xs font-medium text-slate-800">{session.taskTitle}</p>
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
      <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2">
        <div className="flex items-center gap-2 text-slate-600">
          <span className={iconClassName}>{icon}</span>
          <span>{label}</span>
        </div>
        <span className={badgeClassName}>{count}</span>
      </div>
    );
  }

  return (
    <details className="group rounded-md border border-slate-200 bg-white px-2.5 py-2 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex list-none cursor-pointer items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-600">
          <span className={iconClassName}>{icon}</span>
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={badgeClassName}>{count}</span>
          <ChevronRight className="size-3.5 text-slate-500 transition-transform group-open:rotate-90" />
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
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
      <div className="flex items-center gap-2 text-slate-700">
        <Activity className="size-3.5 text-sky-600" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">Agent Activity</span>
      </div>

      <div className="space-y-2">
        <ActivitySection
          label="Active sessions"
          count={activeSessionCount}
          icon={<Activity className="size-3.5 text-sky-600" />}
          iconClassName="inline-flex"
          badgeClassName="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700"
          sessions={activeSessions}
          accentClassName="text-sky-700"
        />
        <ActivitySection
          label="Needs your input"
          count={waitingForInputCount}
          icon={
            <CircleAlert
              className={hasWaitingInput ? "size-3.5 text-amber-600" : "size-3.5 text-slate-400"}
            />
          }
          iconClassName="inline-flex"
          badgeClassName={
            hasWaitingInput
              ? "rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700"
              : "rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600"
          }
          sessions={waitingForInputSessions}
          accentClassName={hasWaitingInput ? "text-amber-700" : "text-slate-600"}
        />
      </div>
    </div>
  );
}
