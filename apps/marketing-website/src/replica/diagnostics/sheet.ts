// The Diagnostics sheet of DiagnosticsSheet.astro: the steps of its sections and of Refresh Checks.
import { data, must } from "../../motion/dom";
import { designPixel, riseIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** The badge and the body of a Diagnostics section. */
export type SectionState = { badge: string; tone: string; body: Node[] };

/** The state that a template holds: `data-badge`, `data-tone`, and the body in its children. */
export function sectionState(template: HTMLElement): SectionState {
  return {
    badge: data(template, "badge"),
    tone: data(template, "tone"),
    body: [...template.childNodes],
  };
}

/** A section of the sheet: its final state, and the steps that change it. */
export function diagnosticsSection(scene: Scene, root: HTMLElement, selector: string) {
  const element = must(root, selector);
  const badge = must(element, "[data-diag-badge]");
  const body = must(element, "[data-diag-body]");
  const final: SectionState = {
    badge: badge.textContent.trim(),
    tone: data(badge, "tone"),
    body: [...body.childNodes],
  };
  const apply = (state: SectionState): void => {
    badge.textContent = state.badge;
    badge.dataset.tone = state.tone;
    body.replaceChildren(...state.body);
  };
  /** Shows a new state. The badge and the body change size, so the sections below move. */
  const change = (state: SectionState, at: number): void =>
    scene.at(at, () => {
      const width = badge.offsetWidth;
      const height = body.offsetHeight;
      apply(state);
      scene.run(
        gsap.fromTo(
          badge,
          { width, scale: 0.9 },
          {
            width: badge.offsetWidth,
            scale: 1,
            duration: 0.35,
            ease: EASE.pop,
            clearProps: "width,transform",
          },
        ),
      );
      scene.run(
        gsap.fromTo(
          body,
          { height },
          { height: body.offsetHeight, duration: 0.4, ease: EASE.move, clearProps: "height" },
        ),
      );
      scene.run(riseIn(body.children, 4 * designPixel(root), 0.3, 0.06));
    });
  return { final, apply, change };
}

/** Refresh Checks is disabled, and its icon spins, while the checks load. */
export function setRefreshing(root: HTMLElement, loading: boolean): void {
  const refresh = must(root, "[data-refresh]");
  refresh.toggleAttribute("data-disabled", loading);
  refresh.toggleAttribute("data-loading", loading);
}
