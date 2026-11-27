// The steps of the Usage page of UsagePage.tsx: the first read when the page opens, and a choice
// of the metric tabs, which the app renders at once.
import { all, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { UsageMetric } from "./format";

/**
 * Seconds of the read of a report from a warm index on the host: 40 to 120 ms in
 * docs/usage.md.
 */
const READ = 0.1;

/** Seconds that the skeleton stays at least: SKELETON_MIN_MS of use-skeleton-hold.ts. */
const SKELETON_HOLD = 0.5;

/** Seconds of usage-enter, the fade of the report that replaces the skeleton. */
const ENTER = 0.32;

/** The steps of the Usage page in `root`. */
export function usagePage(scene: Scene, root: HTMLElement) {
  const page = must(root, "[data-usage-page]");
  const skeleton = must(page, "[data-skeleton]");
  const report = must(page, "[data-report]");
  const tab = (metric: UsageMetric): HTMLElement => must(page, `[data-metric-tab="${metric}"]`);
  const check = (metric: UsageMetric): void => {
    for (const item of all(page, "[data-metric-tab]"))
      item.toggleAttribute("data-checked", item === tab(metric));
  };
  const choose = (metric: UsageMetric): void => {
    page.dataset.metric = metric;
    check(metric);
  };

  return {
    tab,
    /** Build time: the page shows `metric`. */
    prepare: choose,
    /** Build time: the page has no data yet, so it shows its skeleton and reads the report. */
    loading: (): void => {
      page.toggleAttribute("data-fetching", true);
      skeleton.hidden = false;
      report.hidden = true;
    },
    /**
     * The first read answers from the index: the result line shows, and the refresh button stops.
     * The skeleton stays its least time, then the report fades in with usage-enter. Returns the
     * time when the report shows in full.
     */
    open: (at: number): number => {
      scene.at(at + READ, () => page.removeAttribute("data-fetching"));
      const shown = at + SKELETON_HOLD;
      scene.at(shown, () => {
        skeleton.hidden = true;
        report.hidden = false;
        scene.run(
          gsap.fromTo(
            report,
            { autoAlpha: 0, y: 4 * designPixel(root) },
            {
              autoAlpha: 1,
              y: 0,
              duration: ENTER,
              ease: EASE.chat,
              clearProps: "opacity,visibility,transform",
            },
          ),
        );
      });
      return shown + ENTER;
    },
    /** The visitor chooses `metric`: the tab, the words, the chart, and the columns change. */
    choose: (metric: UsageMetric, at: number): void => {
      scene.at(at, () => choose(metric));
    },
  };
}
