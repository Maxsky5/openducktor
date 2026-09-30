// The steps of a question card of QuestionCard.astro, as agent-session-question-card.tsx answers
// them: a single-choice answer opens the next page, and the last answer opens the Summary tab.
import { all, must } from "../../motion/dom";
import { fadeIn, morphHeight } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import type { Pointer } from "../shell/pointer";

/** The answer steps of the question card `card`. The card holds a page for each question. */
export function questionCard(scene: Scene, card: HTMLElement, cursor: Pointer) {
  const part = (selector: string): HTMLElement => must(card, selector);
  const questions = all(card, "[data-q-page]").length - 1;

  /** Picks the answer `label` of question `index`. Returns the time of the click. */
  const choose = (label: string, index: number, at: number, travel: number): number => {
    const option = (): HTMLElement => part(`[data-option="${label}"]`);
    const clicked = cursor.click(option, at, travel);
    scene.at(clicked, () => {
      option().toggleAttribute("data-selected", true);
      part(`[data-q-tab="${index}"]`).toggleAttribute("data-answered", true);
      part("[data-answered-count]").textContent = `${index + 1}/${questions} answered`;
    });
    return clicked;
  };

  /**
   * Opens the page after question `index`: the next question, or the summary. On the last
   * question, Confirm Answers replaces Next. The summary enables Confirm Answers.
   */
  const next = (index: number, at: number): void =>
    scene.at(at, () => {
      const to = index + 1 < questions ? String(index + 1) : "summary";
      const grow = morphHeight(card, () => {
        part(`[data-q-tab="${index}"]`).removeAttribute("data-active");
        part(`[data-q-tab="${to}"]`).toggleAttribute("data-active", true);
        part(`[data-q-page="${index}"]`).hidden = true;
        part(`[data-q-page="${to}"]`).hidden = false;
        if (index + 2 === questions) {
          part("[data-q-next]").hidden = true;
          part("[data-q-confirm]").hidden = false;
        }
        if (to === "summary") {
          part("[data-q-status]").textContent = "All questions answered.";
          part("[data-q-confirm]").removeAttribute("data-disabled");
        }
      });
      if (grow) scene.run(grow);
      scene.run(fadeIn(part(`[data-q-page="${to}"]`), 0.25));
    });

  /** Clicks Confirm Answers, and the answers submit. Returns the time of the click. */
  const confirm = (at: number, travel: number): number => {
    const clicked = cursor.click(() => part("[data-q-confirm]"), at, travel);
    scene.at(clicked, () => {
      part("[data-q-confirm]").toggleAttribute("data-submitting", true);
      part("[data-q-reset]").toggleAttribute("data-disabled", true);
    });
    return clicked;
  };

  return { choose, next, confirm };
}
