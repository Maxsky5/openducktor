import type { UsageIndexProgress } from "@openducktor/contracts";
import { CircleCheck } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatCountOf,
  formatShare,
  USAGE_RUNTIME_COLORS,
  USAGE_RUNTIME_LABELS,
  USAGE_RUNTIMES,
} from "./usage-format";
import type { UsageProgressState } from "./use-usage-progress";

type RuntimeProgress = UsageIndexProgress["runtimes"][number];

/** The share of all parse work: each runtime counts alike, because their measures differ. */
export const overallFraction = (progress: UsageIndexProgress): number => {
  if (progress.phase === "summarizing" || progress.runtimes.length === 0) return 1;
  const sum = progress.runtimes.reduce((total, runtime) => total + runtime.progress, 0);
  return sum / progress.runtimes.length;
};

/** The sessions read of all runtimes, with their total once every runtime knows its total. */
const sessionsOf = (runtimes: readonly RuntimeProgress[]) => {
  let done = 0;
  let total: number | null = 0;
  for (const { sessions } of runtimes) {
    done += sessions.done;
    total = total === null || sessions.total === null ? null : total + sessions.total;
  }
  return { done, total };
};

const sessionsText = ({ done, total }: RuntimeProgress["sessions"]): string =>
  total === null
    ? `${formatCountOf(done, "session")} read, counting the rest…`
    : `${formatCount(done)} of ${formatCountOf(total, "session")}`;

const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** The time since the page saw the first progress event. It updates each second. */
function Elapsed({ sinceMs }: { sinceMs: number }): ReactElement {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatElapsed(now - sinceMs)}</>;
}

const RING_RADIUS = 26;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** A ring that fills with the overall share, or turns while the share is unknown. */
function ProgressRing({ fraction }: { fraction: number }): ReactElement {
  return (
    <div
      role="progressbar"
      aria-label="Usage history read"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      className="relative flex size-16 shrink-0 items-center justify-center"
    >
      <svg
        viewBox="0 0 64 64"
        className={cn(
          "absolute inset-0 -rotate-90",
          fraction === null && "motion-safe:animate-spin",
        )}
        aria-hidden="true"
      >
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="4"
          className="stroke-muted"
        />
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - fraction)}
          className="stroke-foreground transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="text-sm font-semibold tabular-nums">{`${Math.floor(fraction * 100)}%`}</span>
    </div>
  );
}

/** One runtime: its bar in its series color, its share, and its sessions. */
function RuntimeRow({
  entry,
  summarizing,
}: {
  entry: RuntimeProgress;
  summarizing: boolean;
}): ReactElement {
  const label = USAGE_RUNTIME_LABELS[entry.runtime];
  return (
    <li className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 py-3">
      <AgentRuntimeIcon runtimeKind={entry.runtime} className="size-5" />
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {entry.done ? (
            <>
              <CircleCheck className="size-3.5 text-success-muted" aria-hidden="true" />
              {summarizing ? "Read" : "Done"}
            </>
          ) : (
            formatShare(entry.progress)
          )}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} history read`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(entry.progress * 100)}
        className="col-start-2 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full origin-left rounded-full transition-transform duration-500 ease-out"
          style={{
            backgroundColor: USAGE_RUNTIME_COLORS[entry.runtime],
            transform: `scaleX(${entry.progress})`,
          }}
        />
      </div>
      <p className="col-start-2 text-xs text-muted-foreground tabular-nums">
        {sessionsText(entry.sessions)}
      </p>
    </li>
  );
}

/**
 * The first read of a large history: the overall share, the sessions read so far, and one row
 * for each runtime. Later reads parse only new activity and never show it.
 */
export function UsageFirstRead({ state }: { state: UsageProgressState }): ReactElement {
  const { progress, seenSinceMs } = state;
  const summarizing = progress.phase === "summarizing";
  const runtimes = USAGE_RUNTIMES.flatMap((runtime) =>
    progress.runtimes.filter((entry) => entry.runtime === runtime),
  );
  const sessions = sessionsOf(runtimes);
  return (
    <section
      aria-labelledby="usage-first-read"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-xl border border-border bg-card p-6 shadow-xs motion-safe:animate-[usage-enter_240ms_var(--motion-ease-out)] @2xl:p-8"
    >
      <div className="flex items-start gap-5">
        <ProgressRing fraction={overallFraction(progress)} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="usage-first-read" className="text-base font-semibold" aria-live="polite">
            {summarizing ? "Building the daily totals" : "Reading your agent history"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {summarizing
              ? "All history is read. Usage now sums it by day, model, and project."
              : "Usage reads the history of this host once. Later visits read only new activity."}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Sessions read</dt>
          <dd className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-2xl font-semibold tracking-tight">
              {formatCount(sessions.done)}
            </span>
            {sessions.total === null ? null : (
              <span className="text-sm text-muted-foreground">
                of {formatCount(sessions.total)}
              </span>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Elapsed</dt>
          <dd className="text-2xl font-semibold tracking-tight tabular-nums">
            <Elapsed sinceMs={seenSinceMs} />
          </dd>
        </div>
      </dl>
      <ul className="flex flex-col divide-y divide-border">
        {runtimes.map((entry) => (
          <RuntimeRow key={entry.runtime} entry={entry} summarizing={summarizing} />
        ))}
      </ul>
    </section>
  );
}
