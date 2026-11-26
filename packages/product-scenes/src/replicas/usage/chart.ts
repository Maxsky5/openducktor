// The steps of the trend chart of TrendChart.tsx: the crosshair, the point on the total, and the
// tooltip of the day under the pointer. The overview holds a chart for each layout, and the steps
// keep both charts on the same day, so the chart that the stage shows is always right. The steps
// measure the shown chart when the pointer starts to follow it and after a change of the page, and
// each frame reads only the pointer.
import { all, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn, type Point } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import type { Pointer } from "../shell/cursor";
import { EASE } from "../../motion/tokens";
import type { UsageMetric } from "./format";
import { dayCount, dayFigures, type UsageReport } from "./model";
import { chartBox, tipPlace, totalPoint, xOf } from "./trend";

/** One chart of the overview: its layout, its box, and the parts that the steps move. */
function chartParts(element: HTMLElement) {
  const layout = element.closest("[data-chart-layout]");
  if (!(layout instanceof HTMLElement)) throw new Error("Markup has a chart outside its layout.");
  return {
    layout,
    element,
    box: chartBox(Number(element.dataset.chart)),
    crosshair: must(element, "[data-crosshair]", SVGElement),
    dot: must(element, "[data-focus-dot]", SVGElement),
    tip: must(element, "[data-chart-tip]"),
  };
}

type ChartParts = ReturnType<typeof chartParts>;

/**
 * The shown chart and its place in the root, in CSS pixels, with the design pixel, and the metric
 * that the page shows.
 */
type Measure = { chart: ChartParts; origin: Point; u: number; metric: UsageMetric };

/** The steps of the trend charts in `root`. */
export function trendChart(scene: Scene, root: HTMLElement, report: UsageReport) {
  const charts = all(root, "[data-chart]").map(chartParts);
  const days = dayCount(report);
  let focused: number | null = null;
  let measured: Measure | null = null;

  /** The chart of the layout that the stage shows: the stylesheet hides the other layout. */
  const shown = (): ChartParts => {
    const chart = charts.find((parts) => getComputedStyle(parts.layout).display !== "none");
    if (!chart) throw new Error("The Usage page shows no trend chart. Show the report first.");
    return chart;
  };

  const measure = (metric: UsageMetric): void => {
    const chart = shown();
    measured = { chart, origin: offsetIn(chart.element, root), u: designPixel(root), metric };
  };

  /** Shows the crosshair, the point, and the tooltip of the day at `index` in one chart. */
  const show = (chart: ChartParts, index: number, metric: UsageMetric, u: number): void => {
    const [x, y] = totalPoint(chart.box, report, metric, index);
    chart.crosshair.setAttribute("x1", String(x));
    chart.crosshair.setAttribute("x2", String(x));
    chart.dot.setAttribute("cx", String(x));
    chart.dot.setAttribute("cy", String(y));
    const figures = dayFigures(report, index, metric);
    must(chart.tip, "[data-tip-day]").textContent = figures.day;
    must(chart.tip, "[data-tip-so-far]").hidden = index !== days - 1;
    must(chart.tip, "[data-tip-total]").textContent = figures.total;
    for (const row of figures.rows) {
      const line = must(chart.tip, `[data-tip-row="${row.runtime}"]`);
      const share = must(line, "[data-tip-share]");
      share.hidden = row.share === null;
      share.textContent = row.share ?? "";
      must(line, "[data-tip-value]").textContent = row.value;
    }
    const place = tipPlace(chart.box, x, chart.tip.offsetWidth / u, chart.tip.offsetHeight / u);
    chart.tip.style.setProperty("--tip-x", String(place.left));
    chart.tip.style.setProperty("--tip-y", String(place.top));
  };

  /** Inspects the day at `index` in each chart, or no day. */
  const focus = (index: number | null, { u, metric }: Measure): void => {
    if (index === focused) return;
    focused = index;
    for (const chart of charts) {
      const visibility = index === null ? "hidden" : "visible";
      chart.crosshair.setAttribute("visibility", visibility);
      chart.dot.setAttribute("visibility", visibility);
      chart.tip.hidden = index === null;
      if (index !== null) show(chart, index, metric, u);
    }
  };

  /** Inspects the day under the tip of the pointer, while the pointer is over the chart. */
  const track = (cursor: Pointer): void => {
    if (!measured) throw new Error("Measure the chart before the pointer follows it.");
    const { chart, origin, u } = measured;
    const tip = cursor.tip();
    const x = (tip.x - origin.x) / u;
    const y = (tip.y - origin.y) / u;
    const over =
      cursor.visible() && x >= 0 && x <= chart.box.width && y >= 0 && y <= chart.box.height;
    const step = (chart.box.right - chart.box.left) / Math.max(1, days - 1);
    focus(
      over ? gsap.utils.clamp(0, days - 1, Math.round((x - chart.box.left) / step)) : null,
      measured,
    );
  };

  return {
    /**
     * The point of the day at `index`, at `y` in the shown chart, for the pointer. Call it when
     * the pointer step starts.
     */
    aim: (index: number, y: number): Point => {
      const chart = shown();
      const origin = offsetIn(chart.element, root);
      const u = designPixel(root);
      return { x: origin.x + xOf(chart.box, index, days) * u, y: origin.y + y * u };
    },
    /** Inspects the day under the pointer from `from` to `to`. Measure the chart first. */
    follow: (cursor: Pointer, from: number, to: number): void => {
      scene.at(from, () => {
        scene.run(
          gsap.to({}, { duration: to - from, ease: EASE.steady, onUpdate: () => track(cursor) }),
        );
      });
      scene.at(to, () => track(cursor));
    },
    /**
     * Measures the shown chart at `at`, where the page shows `metric`. Call it before the pointer
     * follows the chart, and again after each choice of the metric, which can move the chart.
     */
    measure: (at: number, metric: UsageMetric): void => {
      scene.at(at, () => measure(metric));
    },
  };
}
