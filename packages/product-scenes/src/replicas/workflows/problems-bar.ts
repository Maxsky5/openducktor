// The controller of ProblemsBar.tsx: the readiness line under the canvas changes after each
// edit, with the words that panels/readiness.ts of the editor gives it.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Readiness } from "./model";

export function problemsBar(scene: Scene, root: HTMLElement) {
  const bar = must(root, "[data-problems]");
  const title = must(bar, "[data-problems-title]");
  const detail = must(bar, "[data-problems-detail]");
  const detailText = must(detail, "[data-problems-detail-text]");

  const set = ({ level, title: text, detail: more }: Readiness): void => {
    bar.dataset.level = level ?? "none";
    title.textContent = text;
    detailText.textContent = more ?? "";
    detail.hidden = more === null;
  };

  /** Shows `readiness` at `at`, and its text fades in. */
  const show = (readiness: Readiness, at: number): void =>
    scene.at(at, () => {
      set(readiness);
      scene.run(
        gsap.fromTo(
          [...bar.children],
          { autoAlpha: 0.2 },
          { autoAlpha: 1, duration: 0.25, ease: EASE.gentle, clearProps: "opacity,visibility" },
        ),
      );
    });

  return { reset: set, show };
}
