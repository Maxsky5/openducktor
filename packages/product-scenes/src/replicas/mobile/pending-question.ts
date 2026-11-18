// The steps of a pending Structured Question in a mobile session: the card of QuestionCard.tsx and
// the question row of QuestionToolRow.tsx, as structured-question-card.tsx, request-card.tsx, and
// tool-status.tsx move them. A tap on an option chooses it when the finger lifts, and the answered
// count, the hint, and Confirm Answers change with it. A tap on Confirm Answers submits the answer:
// the inputs dim, and the status line comes under the body. The card takes its new height with
// the layout animation of request-card.tsx, and the screen takes the new layout at once. When the
// host confirms the answer, the pending list leaves the screen: the transcript takes its place at
// once, the question call ends with its answer, and the icon of the tool grows in with
// icon-swap.ts. The card goes in the same frame. Its exit fade of request-card.tsx runs where the
// card was in the bottom stack of session-view.tsx, and that stack now ends at the composer, so the
// opaque composer covers the fading card and the stack clips the rest of it.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { APP_EASE_OUT } from "./app-motion";
import type { finger } from "./finger";
import { swapIcon } from "./icon-swap";
import type { QuestionState } from "./QuestionCard";

/** CARD_LAYOUT of request-card.tsx: a card takes its new size in `motion.base`, 240 ms. */
export const CARD_LAYOUT = 0.24;

/** A tap of finger.ts: it presses the target at a time and returns the release. */
type Tap = ReturnType<typeof finger>["tap"];

/**
 * Animates the card from the height `from` to its height now, as the layout animation of the app
 * moves the frame of the card: the content and the screen have the new layout at once, and the
 * outline and the surface of the card follow. The margin keeps the new height in the layout.
 */
function layoutTransition(card: HTMLElement, from: number): gsap.core.Tween | undefined {
  const to = card.offsetHeight;
  if (to === from) return undefined;
  return gsap.fromTo(
    card,
    { height: from, marginBottom: to - from },
    {
      height: to,
      marginBottom: 0,
      duration: CARD_LAYOUT,
      ease: APP_EASE_OUT,
      clearProps: "height,marginBottom",
    },
  );
}

/** The pending question of the session screen `screen`. */
export function pendingQuestion(scene: Scene, screen: HTMLElement, tap: Tap) {
  const card = must(screen, '[data-request="question"]');
  const row = must(screen, "[data-question-row]");
  const option = (label: string): HTMLElement => must(card, `[data-option="${label}"]`);
  const setState = (state: QuestionState): void => {
    card.dataset.requestState = state;
  };

  /** Build time: the question waits for its answer, and no option is chosen. */
  const wait = (): void => {
    card.hidden = false;
    setState("open");
    for (const chosen of card.querySelectorAll("[data-option]")) {
      chosen.removeAttribute("data-selected");
    }
    row.toggleAttribute("data-running", true);
    row.removeAttribute("data-answered");
  };

  /** Taps the option `label` at `at`. Returns the release, when the option is chosen. */
  const choose = (label: string, at: number): number => {
    const chosen = tap(() => option(label), at);
    scene.at(chosen, () => {
      option(label).toggleAttribute("data-selected", true);
      setState("complete");
    });
    return chosen;
  };

  /** Taps Confirm Answers at `at`. Returns the release, when the answer submits. */
  const confirm = (at: number): number => {
    const sent = tap(() => must(card, '[data-reply="confirm"]'), at);
    scene.at(sent, () => {
      const height = card.offsetHeight;
      setState("submitting");
      const grow = layoutTransition(card, height);
      if (grow) scene.run(grow);
    });
    return sent;
  };

  /**
   * The host confirms the answer at `at`. The card and the pending list go at once, and the
   * question call shows its answer and the icon of its tool.
   */
  const answer = (at: number): void => {
    swapIcon(scene, must(row, "[data-call-glyph]", SVGElement), at);
    scene.at(at, () => {
      card.hidden = true;
      row.removeAttribute("data-running");
      row.toggleAttribute("data-answered", true);
    });
  };

  return { wait, choose, confirm, answer };
}
