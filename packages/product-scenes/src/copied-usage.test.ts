import { describe, expect, test } from "bun:test";
import type { ChartPoint } from "./replicas/usage/curve";
import type { RuntimeKind } from "./sample/models";
import {
  DAY_TEXT,
  formatAxisMetric,
  formatCompactCount,
  formatMetric,
  formatRange,
  formatShare,
  formatUsd,
  labelIndexes,
  METRIC_TEXT,
  USAGE_RUNTIME_LABELS,
  type UsageMetric,
} from "./replicas/usage/format";
import {
  dailyTotals,
  dayFigures,
  daysOf,
  highlightFigures,
  reportTotal,
  runtimeLine,
  summaryText,
} from "./replicas/usage/model";
import { chartBox, marksOf, niceTop, tipPlace, valueTicks, xOf } from "./replicas/usage/trend";
import { RANGE_TABS } from "./replicas/usage/UsageHeader";
import { CHART_WIDTHS, INSPECTED_DAY, REPORT } from "./scenes/usage/sample";
import { readProductWords } from "./test-support/product-source";
import {
  appReport,
  d3,
  format,
  resolveChartTooltipPlacement,
  scaleLinear,
  scaleUtc,
  usageHighlights,
} from "./test-support/usage-product";

const PAGE = "packages/frontend/src/pages/usage";
const METRICS = ["tokens", "cost"] as const satisfies readonly UsageMetric[];

const app = appReport(REPORT);

describe("usage scene copies", () => {
  test("the runtimes, the metrics, and the day words are the words of the app", () => {
    const labels: Record<RuntimeKind, string> = USAGE_RUNTIME_LABELS;
    expect(labels).toEqual(format.USAGE_RUNTIME_LABELS);
    expect(METRIC_TEXT).toEqual(format.METRIC_TEXT);
    expect(DAY_TEXT).toEqual(format.PERIOD_TEXT.day);
    expect(REPORT.runtimes.map((usage) => usage.runtime)).toEqual([...format.USAGE_RUNTIMES]);
  });

  test("the numbers have the formats of the app", () => {
    const values = [0, 0.004, 1.2, 9.99, 34.63, 495.49, 999.99, 1234.5, 8e6, 57.7e6, 1.8436e9, 6e9];
    for (const value of values) {
      expect(formatCompactCount(value)).toBe(format.formatCompactCount(value));
      expect(formatUsd(value)).toBe(format.formatUsd(value));
      for (const metric of METRICS) {
        expect(formatMetric(value, metric)).toBe(format.formatMetric(value, metric));
        expect(formatAxisMetric(value, metric)).toBe(format.formatAxisMetric(value, metric));
      }
    }
    for (const share of [0, 0.0004, 0.023, 0.614, 0.9996, 1])
      expect(formatShare(share)).toBe(format.formatShare(share));
    expect(formatRange(REPORT.start, REPORT.end)).toBe(
      format.formatRange(REPORT.start, REPORT.end),
    );
  });

  test("the overview and the tooltip show what the app computes from the report", () => {
    for (const metric of METRICS) {
      const total = reportTotal(REPORT, metric);
      expect(dailyTotals(REPORT, metric)).toEqual(
        app.periods.map(
          (period) => format.periodTotal(period, format.USAGE_RUNTIMES, metric).value,
        ),
      );
      for (const [index, usage] of REPORT.runtimes.entries()) {
        const row = app.byRuntime[index];
        if (!row) throw new Error("The report lost a runtime.");
        const share = format.shareOf(row.figure, total, metric);
        const line = runtimeLine(REPORT, usage, metric);
        expect(line.share).toBe(format.formatShare(share ?? 0));
        expect(line.noun).toBe(` of ${format.METRIC_TEXT[metric].noun}`);
      }
      const period = app.periods[INSPECTED_DAY];
      if (!period) throw new Error("The inspected day is outside the report.");
      const day = format.periodTotal(period, format.USAGE_RUNTIMES, metric);
      const figures = dayFigures(REPORT, INSPECTED_DAY, metric);
      expect(figures.day).toBe(format.periodName(period, "day"));
      expect(figures.total).toBe(format.formatMetric(day.value, metric));
      expect(figures.rows.map((row) => row.value)).toEqual(
        day.parts.map((part) => format.formatMetric(part.value ?? 0, metric)),
      );
    }
    expect(summaryText(REPORT, "tokens")).toBe(
      `412 sessions · ${formatUsd(reportTotal(REPORT, "cost"))}`,
    );
  });

  test("the Highlights show the figures of usageHighlights", () => {
    for (const metric of METRICS) {
      const expected = usageHighlights(app, metric);
      const tiles = highlightFigures(REPORT, metric);
      expect(expected.note).toBeNull();
      expect(tiles.cacheHit.value).toBe(format.formatShare(expected.cacheHit.rate ?? 0));
      expect(tiles.cacheHit.detail).toBe(
        `${format.formatCompactCount(expected.cacheHit.cacheRead)} of ${format.formatCompactCount(expected.cacheHit.inputSide)} input tokens from cache`,
      );
      expect(tiles.busiest.index).toBe(expected.busiest.index);
      expect(tiles.busiest.values).toEqual(expected.values);
      expect(tiles.busiest.value).toBe(format.formatMetric(expected.busiest.value ?? 0, metric));
      expect(tiles.average.value).toBe(format.formatMetric(expected.average.value ?? 0, metric));
      expect(tiles.average.detail).toBe(
        `${expected.average.activeCount} of ${expected.values.length} days active`,
      );
      expect(tiles.perSession.value).toBe(
        format.formatMetric(expected.perSession.value ?? 0, metric),
      );
      expect(tiles.perSession.detail).toBe(`Over ${expected.perSession.sessions} active sessions`);
    }
    expect(highlightFigures(REPORT, "tokens").busiest.index).toBe(INSPECTED_DAY);
  });

  test("the chart draws the stacked bands and the total of the app at each width", () => {
    const line = d3.line().curve(d3.curveMonotoneX);
    const area = d3
      .area()
      .x((row) => row[0] ?? 0)
      .y0((row) => row[1] ?? 0)
      .y1((row) => row[2] ?? 0)
      .curve(d3.curveMonotoneX);
    const dates = app.periods.map((period) => format.dateOf(period.start));
    for (const width of [CHART_WIDTHS.wide, CHART_WIDTHS.narrow]) {
      const box = chartBox(width);
      const x = scaleUtc()
        .domain([dates[0] ?? new Date(0), dates.at(-1) ?? new Date(0)])
        .range([box.left, box.right]);
      const xs = dates.map((date) => x(date));
      for (const metric of METRICS) {
        const totals = app.periods.map((period) =>
          format.periodTotal(period, format.USAGE_RUNTIMES, metric),
        );
        const y = scaleLinear()
          .domain([0, Math.max(...totals.map((total) => total.value))])
          .nice(4)
          .range([box.bottom, box.top]);
        const marks = marksOf(box, REPORT, metric);
        // stackOf of usage-trend-chart.tsx: each band starts at the top of the band before it.
        let lows = totals.map(() => 0);
        for (const [band, runtime] of format.USAGE_RUNTIMES.entries()) {
          const highs = totals.map(
            (total, index) => (lows[index] ?? 0) + (total.parts[band]?.value ?? 0),
          );
          const rows = xs.map((at, index) => [at, y(lows[index] ?? 0), y(highs[index] ?? 0)]);
          expect(marks.bands[band]?.runtime).toBe(runtime);
          expect(marks.bands[band]?.area).toBe(area(rows));
          expect(marks.bands[band]?.line).toBe(
            line(rows.map((row): ChartPoint => [row[0] ?? 0, row[2] ?? 0])),
          );
          lows = highs;
        }
        const points = xs.map((at, index): ChartPoint => [at, y(totals[index]?.value ?? 0)]);
        expect(marks.total).toBe(line(points.slice(0, -1)));
        expect(marks.current).toBe(line(points.slice(-2)));
        expect(marks.today).toEqual(points.at(-1) ?? null);
      }
    }
  });

  test("the chart has the value ticks, the date labels, and the tooltip place of the app", () => {
    for (const metric of METRICS) {
      const max = Math.max(...dailyTotals(REPORT, metric));
      const scale = scaleLinear().domain([0, max]).nice(4);
      expect(niceTop(max)).toBe(scale.domain()[1] ?? 0);
      expect(valueTicks(niceTop(max))).toEqual(scale.ticks(4));
    }
    expect(labelIndexes(app.periods.length, 5).map((index) => daysOf(REPORT)[index])).toEqual(
      format.labelDates(app.periods, 5, "day"),
    );
    const sizes = [205, 240].map((width) => ({ width, height: 162 }));
    for (const box of [CHART_WIDTHS.wide, CHART_WIDTHS.narrow].map(chartBox))
      for (const index of [0, 8, INSPECTED_DAY, 29])
        for (const size of sizes) {
          const at = xOf(box, index, app.periods.length);
          const bounds = { left: 0, top: 0, right: box.width, bottom: box.height };
          const placed = resolveChartTooltipPlacement(
            { x: at, y: box.top },
            size,
            bounds,
            ["right", "left"],
            16,
          );
          expect(tipPlace(box, at, size.width, size.height)).toEqual({
            left: placed.left,
            top: placed.top,
          });
        }
  });

  test("the words of the markup are the words of the app", async () => {
    const words = await readProductWords([
      `${PAGE}/usage-page.tsx`,
      `${PAGE}/usage-filters.tsx`,
      `${PAGE}/usage-overview.tsx`,
      `${PAGE}/usage-highlights.tsx`,
      `${PAGE}/usage-trend-chart.tsx`,
      `${PAGE}/use-skeleton-hold.ts`,
      "packages/frontend/src/components/layout/sidebar/sidebar-navigation.tsx",
    ]);
    for (const tab of RANGE_TABS)
      expect(words).toContain(`kind: "${tab.kind}", label: "${tab.label}", short: "${tab.short}"`);
    for (const word of [
      ">Usage</h1>",
      '"All runtimes"',
      "`Updated ${formatTime(report.resultAt)}`",
      'label="Cache hit rate"',
      "label={`Busiest ${noun}`}",
      "label={`${adjective} average`}",
      'label="Per session"',
      'title="Highlights"',
      "input tokens from cache`",
      " active`}",
      'detail={`Over ${formatCountOf(sessions, "active session")}`}',
      "/> Total </span>",
      " · so far</span>",
      // The size, the gutters, and the tooltip of the chart.
      "const CHART_HEIGHT = 280;",
      "const MARGIN = { top: 12, right: 8, bottom: 28, left: 56 };",
      "const NARROW_MARGIN = { ...MARGIN, left: 44 };",
      "const narrow = width > 0 && width < 480;",
      'anchor: { x: "value", y: "plot-top" }, placement: ["right", "left"], offset: 16,',
      // The first read: the skeleton stays 500 ms, and the report fades in with usage-enter.
      "SKELETON_MIN_MS = 500",
      "animate-[usage-enter_320ms_var(--motion-ease-out)]",
      // The Usage link of the sidebar footer and its look as the current page.
      '{ route: USAGE_PATH, label: "Usage", title: usageTitle, icon: ChartSpline }',
      'activeClassName="bg-accent text-accent-foreground ring-1 ring-border"',
    ])
      expect(words).toContain(word);
  });
});
