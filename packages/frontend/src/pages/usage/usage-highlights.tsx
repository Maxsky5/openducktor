import type { UsageReport } from "@openducktor/contracts";
import { CalendarCheck, DatabaseZap, Flame, Info, Users, type LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  formatCompactCount,
  formatCount,
  formatCountOf,
  formatMetric,
  formatShare,
  PERIOD_TEXT,
  periodName,
  USAGE_RUNTIME_COLORS,
  USAGE_RUNTIMES,
  type UsageMetric,
} from "./usage-format";
import { Explained, MissingValue, SectionHeading } from "./usage-parts";
import { type UsageHighlights as Highlights, usageHighlights } from "./usage-report";

/** One tile: an icon and a label, the value, a small chart, and a detail line. */
function HighlightTile({
  icon: Icon,
  label,
  value,
  note,
  chart,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  note: string | null;
  chart: ReactNode;
  detail: string;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-3 bg-card p-4 @2xl:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
        {note ? (
          <Explained text={note} className="inline-flex text-muted-foreground">
            <Info className="size-3.5" aria-hidden="true" />
          </Explained>
        ) : null}
      </div>
      <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      <div className="flex h-7 items-end" aria-hidden="true">
        {chart}
      </div>
      <span className="truncate text-xs text-muted-foreground tabular-nums">{detail}</span>
    </div>
  );
}

/** A thin track filled to a share. */
function Meter({ share }: { share: number }): ReactElement {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full origin-left rounded-full bg-foreground/80 transition-transform duration-500 ease-out"
        style={{ transform: `scaleX(${share})` }}
      />
    </div>
  );
}

/** One column for each period, scaled to the largest; the busiest one in full ink. */
function PeriodColumns({
  values,
  busiest,
}: {
  values: readonly number[];
  busiest: number;
}): ReactElement {
  const max = Math.max(...values, 0);
  return (
    <div className="flex h-full w-full items-end gap-px">
      {values.map((value, index) => (
        <span
          // Periods keep their order, so the index is a stable key.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={cn(
            "min-w-px flex-1 rounded-t-[2px]",
            index === busiest ? "bg-foreground" : "bg-muted-foreground/25",
          )}
          // A period with a value keeps a visible column.
          style={{ height: max === 0 || value === 0 ? 2 : `max(3px, ${(value / max) * 100}%)` }}
        />
      ))}
    </div>
  );
}

/** One cell for each period: dark when it had activity. */
function ActivityStrip({ active }: { active: readonly boolean[] }): ReactElement {
  return (
    <div className="flex h-2 w-full gap-px self-center">
      {active.map((on, index) => (
        <span
          // Periods keep their order, so the index is a stable key.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={cn(
            "min-w-px flex-1 first:rounded-l-full last:rounded-r-full",
            on ? "bg-foreground/80" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

/** The sessions of each runtime, in their series colors. */
function SessionMix({ byRuntime }: { byRuntime: UsageReport["byRuntime"] }): ReactElement {
  const total = byRuntime.reduce((sum, entry) => sum + entry.figure.sessions, 0);
  const parts = USAGE_RUNTIMES.flatMap((runtime) =>
    byRuntime.filter((entry) => entry.runtime === runtime && entry.figure.sessions > 0),
  );
  return (
    <div className="flex h-1.5 w-full gap-0.5 self-center overflow-hidden rounded-full bg-muted">
      {parts.map((entry) => (
        <span
          key={entry.runtime}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{
            width: `${(entry.figure.sessions / Math.max(1, total)) * 100}%`,
            minWidth: 4,
            background: USAGE_RUNTIME_COLORS[entry.runtime],
          }}
        />
      ))}
    </div>
  );
}

type TileProps = { report: UsageReport; metric: UsageMetric; highlights: Highlights };

/** The share of input-side tokens that came from the cache. */
function CacheHitTile({ highlights }: TileProps): ReactElement {
  const { rate, missing, cacheRead, inputSide, note } = highlights.cacheHit;
  return (
    <HighlightTile
      icon={DatabaseZap}
      label="Cache hit rate"
      value={rate === null ? <MissingValue reason={missing} /> : formatShare(rate)}
      note={note}
      chart={<Meter share={rate ?? 0} />}
      detail={`${formatCompactCount(cacheRead)} of ${formatCompactCount(inputSide)} input tokens from cache`}
    />
  );
}

function BusiestTile({ report, metric, highlights }: TileProps): ReactElement {
  const { value, missing, period, index } = highlights.busiest;
  const noun = PERIOD_TEXT[report.granularity].noun;
  return (
    <HighlightTile
      icon={Flame}
      label={`Busiest ${noun}`}
      value={value === null ? <MissingValue reason={missing} /> : formatMetric(value, metric)}
      note={highlights.note}
      chart={<PeriodColumns values={highlights.values} busiest={index} />}
      detail={period ? periodName(period, report.granularity) : `No ${noun} with a value`}
    />
  );
}

function AverageTile({ report, metric, highlights }: TileProps): ReactElement {
  const { noun, adjective } = PERIOD_TEXT[report.granularity];
  const { value, missing, activeCount } = highlights.average;
  return (
    <HighlightTile
      icon={CalendarCheck}
      label={`${adjective} average`}
      value={value === null ? <MissingValue reason={missing} /> : formatMetric(value, metric)}
      note={highlights.note}
      chart={<ActivityStrip active={highlights.values.map((entry) => entry > 0)} />}
      detail={`${formatCount(activeCount)} of ${formatCountOf(highlights.values.length, noun)} active`}
    />
  );
}

function PerSessionTile({ report, metric, highlights }: TileProps): ReactElement {
  const { value, missing, sessions } = highlights.perSession;
  return (
    <HighlightTile
      icon={Users}
      label="Per session"
      value={value === null ? <MissingValue reason={missing} /> : formatMetric(value, metric)}
      note={highlights.note}
      chart={<SessionMix byRuntime={report.byRuntime} />}
      detail={`Over ${formatCountOf(sessions, "active session")}`}
    />
  );
}

/** Figures derived from the report: cache use, the busiest period, and averages. */
export function UsageHighlights({
  report,
  metric,
}: {
  report: UsageReport;
  metric: UsageMetric;
}): ReactElement {
  const tile = { report, metric, highlights: usageHighlights(report, metric) };
  return (
    <section aria-labelledby="usage-highlights" className="flex flex-col gap-3">
      <SectionHeading id="usage-highlights" title="Highlights" />
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border @md:grid-cols-2 @4xl:grid-cols-4">
        <CacheHitTile {...tile} />
        <BusiestTile {...tile} />
        <AverageTile {...tile} />
        <PerSessionTile {...tile} />
      </div>
    </section>
  );
}
