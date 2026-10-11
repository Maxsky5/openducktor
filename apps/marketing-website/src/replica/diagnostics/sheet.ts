// The Diagnostics sheet of DiagnosticsSheet.astro: the steps of its checks, its overview, and
// Refresh.
import { must } from "../../motion/dom";
import { designPixel, morphHeight, riseIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { DiagOverviewData, DiagStatusData } from "./model";

/** The checks and the overview of the sheet in `root`, and the steps that change them. */
export function diagnosticsSheet(scene: Scene, root: HTMLElement) {
  const check = (id: string): HTMLElement => must(root, `[data-diag="${id}"]`);
  const pill = (id: string): HTMLElement => must(check(id), "[data-diag-pill]");
  const overviewBox = must(root, "[data-diag-overview]");

  /** Shows a status at once. A runtime that starts shows its progress line. */
  const set = (id: string, status: DiagStatusData): void => {
    const element = pill(id);
    element.dataset.health = status.health;
    must(element, "[data-diag-label]").textContent = status.label;
    const progress = check(id).querySelector("[data-diag-progress]");
    if (progress instanceof HTMLElement) progress.hidden = status.health !== "busy";
  };

  /** A check finishes at `at`. Its pill takes the new width, and a progress line closes. */
  const finish = (id: string, status: DiagStatusData, at: number): void =>
    scene.at(at, () => {
      const element = pill(id);
      const width = element.offsetWidth;
      const row = check(id);
      const grow = morphHeight(row, () => set(id, status));
      if (grow) scene.run(grow);
      scene.run(
        gsap.fromTo(
          element,
          { width, scale: 0.9 },
          {
            width: element.offsetWidth,
            scale: 1,
            duration: 0.35,
            ease: EASE.pop,
            clearProps: "width,transform",
          },
        ),
      );
    });

  const setOverview = (overview: DiagOverviewData): void => {
    overviewBox.dataset.tone = overview.tone;
    must(overviewBox, "[data-diag-overview-title]").textContent = overview.title;
    must(overviewBox, "[data-diag-overview-text]").textContent = overview.description;
  };

  /** The overview changes at `at`. */
  const overview = (next: DiagOverviewData, at: number): void =>
    scene.at(at, () => {
      setOverview(next);
      scene.run(riseIn(overviewBox.children, 4 * designPixel(root)));
    });

  /** Refresh is disabled, and its icon spins, while the checks run. */
  const setRefreshing = (loading: boolean): void => {
    const refresh = must(root, "[data-refresh]");
    refresh.toggleAttribute("data-disabled", loading);
    refresh.toggleAttribute("data-loading", loading);
    must(refresh, "[data-refresh-label]").textContent = loading ? "Refreshing" : "Refresh";
  };

  return { set, finish, setOverview, overview, setRefreshing };
}
