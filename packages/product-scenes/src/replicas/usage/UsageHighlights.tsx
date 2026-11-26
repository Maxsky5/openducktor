// UsageHighlights of usage-highlights.tsx: the cache use, the busiest day, and the averages, each
// in a tile with a small chart. The columns of the busiest day hold their heights in both metrics,
// and the metric of the page shows one set.
import { CalendarCheck, DatabaseZap, Flame, type LucideIcon, Users } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import { DAY_TEXT } from "./format";
import {
  columnHeight,
  type HighlightFigures,
  highlightFigures,
  reportSessions,
  type UsageReport,
} from "./model";
import { MetricText } from "./MetricText";
import { SectionHeading } from "./UsageParts";
import "./UsageHighlights.css";

function HighlightTile({
  icon: Icon,
  label,
  value,
  chart,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  chart: ReactNode;
  detail: ReactNode;
}): ReactElement {
  return (
    <div className="usage-tile">
      <span className="usage-tile-label">
        <Icon className="i14" aria-hidden="true" />
        <span>{label}</span>
      </span>
      <span className="usage-tile-value">{value}</span>
      <div className="usage-tile-chart">{chart}</div>
      <span className="usage-tile-detail">{detail}</span>
    </div>
  );
}

type BarStyle = CSSProperties & { "--bar-tokens": string; "--bar-cost": string };

type Busiest = HighlightFigures["busiest"];

/** One column for each day, scaled to the largest; the busiest one in full ink. */
function DayColumns({ tokens, cost }: { tokens: Busiest; cost: Busiest }): ReactElement {
  const tokensMax = Math.max(...tokens.values, 0);
  const costMax = Math.max(...cost.values, 0);
  return (
    <div className="usage-columns">
      {tokens.values.map((value, index) => {
        const spent = cost.values[index] ?? 0;
        const style: BarStyle = {
          "--bar-tokens": columnHeight(value, tokensMax),
          "--bar-cost": columnHeight(spent, costMax),
        };
        return (
          <span
            // The days keep their order, so the index is a stable key.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            data-busiest-tokens={flag(index === tokens.index)}
            data-busiest-cost={flag(index === cost.index)}
            data-empty-tokens={flag(value === 0)}
            data-empty-cost={flag(spent === 0)}
            style={style}
          />
        );
      })}
    </div>
  );
}

export function UsageHighlights({ report }: { report: UsageReport }): ReactElement {
  const tokens = highlightFigures(report, "tokens");
  const cost = highlightFigures(report, "cost");
  const sessions = reportSessions(report);
  return (
    <div className="usage-highlights">
      <SectionHeading title="Highlights" />
      <div className="usage-tiles">
        <HighlightTile
          icon={DatabaseZap}
          label="Cache hit rate"
          value={tokens.cacheHit.value}
          chart={
            <div className="usage-meter">
              <div
                className="usage-meter-fill"
                style={{ transform: `scaleX(${tokens.cacheHit.share})` }}
              />
            </div>
          }
          detail={tokens.cacheHit.detail}
        />
        <HighlightTile
          icon={Flame}
          label={`Busiest ${DAY_TEXT.noun}`}
          value={<MetricText tokens={tokens.busiest.value} cost={cost.busiest.value} />}
          chart={<DayColumns tokens={tokens.busiest} cost={cost.busiest} />}
          detail={<MetricText tokens={tokens.busiest.detail} cost={cost.busiest.detail} />}
        />
        <HighlightTile
          icon={CalendarCheck}
          label={`${DAY_TEXT.adjective} average`}
          value={<MetricText tokens={tokens.average.value} cost={cost.average.value} />}
          chart={
            <div className="usage-strip">
              {tokens.average.active.map((on, index) => (
                // oxlint-disable-next-line react/no-array-index-key
                <span key={index} data-on={flag(on)} />
              ))}
            </div>
          }
          detail={tokens.average.detail}
        />
        <HighlightTile
          icon={Users}
          label="Per session"
          value={<MetricText tokens={tokens.perSession.value} cost={cost.perSession.value} />}
          chart={
            <div className="usage-mix">
              {report.runtimes.map((usage) => (
                <span
                  key={usage.runtime}
                  data-series={usage.runtime}
                  style={{ width: `${(usage.sessions / Math.max(1, sessions)) * 100}%` }}
                />
              ))}
            </div>
          }
          detail={tokens.perSession.detail}
        />
      </div>
    </div>
  );
}
