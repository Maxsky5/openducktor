import { must } from "../../motion/dom";
import type { Point } from "../../motion/offset";
import type { SceneBuilder } from "../../motion/scene";
import { pointer } from "../../replicas/shell/cursor";
import { trendChart } from "../../replicas/usage/chart";
import { usagePage } from "../../replicas/usage/page";
import { INSPECTED_DAY, REPORT } from "./sample";

/** Seconds that the visitor reads the tooltip of the busiest day in tokens, then in cost. */
const READ_TOKENS = 1.6;
const READ_COST = 1.5;

/** Seconds that the visitor looks at the new page before the pointer moves to the chart. */
const LOOK = 0.4;

/** Seconds that the last frame stays after the pointer leaves. */
const HOLD = 1.6;

/**
 * The places of the pointer in the chart, in its design pixels: in the bands under the tooltip,
 * above the plot in the row of the chart title, and under the date labels.
 */
const IN_BANDS = 160;
const ABOVE = -24;
const BELOW = 304;

/**
 * The visitor is on the Kanban board and selects Usage in the footer of the sidebar. The Usage
 * page opens on the last 30 days in tokens: the skeleton shows while the first read runs, then the
 * report fades in, as in the app. The visitor moves up onto the busiest day, and the tooltip gives
 * its tokens. The visitor selects Cost, and the page renders the cost at once: the words, the
 * chart, and its axis. The visitor points at the busiest day again, and the tooltip gives its cost.
 * The pointer goes straight up or down at that day, so the tooltip shows no other day. A phone
 * stage shows the sidebar first, and the page in its place after the click. The markup holds the
 * last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const board = must(root, "[data-board-page]");
  const kanban = must(root, "[data-kanban]");
  const usageLink = must(root, '[data-footer-link="usage"]');
  const page = usagePage(scene, root);
  const usage = must(root, "[data-usage-page]");
  const chart = trendChart(scene, root, REPORT);
  const hand = pointer(scene, root);
  const onDay =
    (y: number): (() => Point) =>
    () =>
      chart.aim(INSPECTED_DAY, y);

  // Start: the Kanban board is the current page, and Usage opens on 30 days and Tokens.
  root.dataset.pane = "sidebar";
  board.hidden = false;
  usage.hidden = true;
  kanban.setAttribute("aria-current", "true");
  usageLink.removeAttribute("data-current");
  page.prepare("tokens");
  page.loading();

  // 1. The visitor selects Usage in the footer of the sidebar. The link becomes current, and the
  //    page area shows the Usage page with its skeleton, then the report.
  const opened = hand.click(() => usageLink, 0.4, 0.8);
  scene.at(opened + 0.05, () => {
    root.dataset.pane = "main";
    kanban.removeAttribute("aria-current");
    usageLink.toggleAttribute("data-current", true);
    board.hidden = true;
    usage.hidden = false;
  });
  const shown = page.open(opened + 0.05);
  scene.mark("report", shown);

  // 2. The pointer moves under the chart and up onto the busiest day. The crosshair and the
  //    tooltip show while the pointer is over the chart.
  const under = hand.point(onDay(BELOW), shown + LOOK, 0.8);
  const inspected = hand.point(onDay(IN_BANDS), under, 0.45);
  scene.mark("inspect", inspected);

  // 3. The pointer leaves the chart upward, and the visitor selects Cost. The page renders the
  //    cost at once.
  const left = hand.point(onDay(ABOVE), inspected + READ_TOKENS, 0.4);
  const chosen = hand.click(() => page.tab("cost"), left + 0.05, 0.6);
  page.choose("cost", chosen + 0.05);
  chart.measure(chosen + 0.05, "cost");
  scene.mark("cost", chosen);

  // 4. The visitor points at the busiest day again: the tooltip gives its cost. Then the pointer
  //    leaves the chart downward, and the tooltip closes.
  const back = hand.point(onDay(ABOVE), chosen + 0.4, 0.55);
  const costed = hand.point(onDay(IN_BANDS), back, 0.4);
  scene.mark("cost-day", costed);
  const gone = hand.point(onDay(BELOW), costed + READ_COST, 0.45);
  chart.measure(shown, "tokens");
  chart.follow(hand, shown, gone);
  hand.hide(gone);
  scene.endAt(gone + HOLD);
};
