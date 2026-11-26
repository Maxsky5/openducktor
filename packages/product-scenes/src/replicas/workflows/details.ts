// The controller of the details panel of WorkflowEditor.tsx: it opens with the details of the
// selection, switches between the state and the transition details, and closes when the
// selection clears. A board button that the user adds replaces the warning of the transition.
import { must } from "../../motion/dom";
import { designPixel, fadeIn, revealTween } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { CanvasView } from "./canvas-view";
import { VIEWPORT_MOVE } from "./viewport";

type DetailsKind = "state" | "event";

/** Seconds that the details fade out when the selection clears. */
const CLOSE = 0.12;

/**
 * The details of `root`. The panel takes its place beside the canvas or, on a phone stage, under
 * it, and `view` keeps the canvas content still while the canvas changes size.
 */
export function detailsPanel(scene: Scene, root: HTMLElement, view: CanvasView) {
  const panels = must(root, ".wfe-panels");
  const panel = must(panels, "[data-details]");
  const handle = must(root, "[data-details-handle]");
  const inspector = (kind: DetailsKind): HTMLElement => must(panel, `[data-inspector="${kind}"]`);
  const event = inspector("event");
  const problem = must(event, "[data-element-problem]");
  const triggerRow = must(event, "[data-trigger-row]");

  /** Shows the details of `kind`, or no details. */
  const set = (kind: DetailsKind | null): void => {
    panel.hidden = kind === null;
    handle.hidden = kind === null;
    for (const name of ["state", "event"] as const) inspector(name).hidden = name !== kind;
  };

  /** The transition has no trigger yet: the warning shows, and no board button. */
  const untrigger = (): void => {
    event.removeAttribute("data-triggered");
    problem.hidden = false;
    triggerRow.hidden = true;
  };

  /**
   * Opens the details of `kind` at `at`. The panel takes its place at once, as in the app, and its
   * content fades in. `placed` runs when the panel has its place, such as the fit of the canvas. A
   * panel under the canvas slides in while the canvas fits: WorkflowEditor.css stacks the panels
   * on a phone stage. Open details show the new selection at once.
   */
  const open = (kind: DetailsKind, at: number, placed: () => void = () => undefined): void =>
    scene.at(at, () => {
      if (!panel.hidden) {
        set(kind);
        return;
      }
      view.keepPlace(() => set(kind));
      placed();
      if (getComputedStyle(panels).flexDirection === "column") {
        panel.toggleAttribute("data-resizing", true);
        scene.run(
          gsap.from(panel, {
            flexBasis: 0,
            duration: VIEWPORT_MOVE,
            ease: EASE.move,
            clearProps: "flexBasis",
            onComplete: () => panel.removeAttribute("data-resizing"),
          }),
        );
      }
      scene.run(fadeIn(inspector(kind), 0.15));
    });

  /** The selection clears at `at`: the details fade, then the panel goes. Returns the end time. */
  const close = (at: number): number => {
    scene.at(at, () => {
      scene.run(
        gsap.to(panel, {
          autoAlpha: 0,
          duration: CLOSE,
          ease: EASE.exit,
          onComplete: () => {
            view.keepPlace(() => set(null));
            gsap.set(panel, { clearProps: "opacity,visibility" });
          },
        }),
      );
    });
    return at + CLOSE;
  };

  /**
   * The details scroll at `at` until the card of the element of `find` shows whole, with a margin
   * under it, as the user scrolls a short panel. A panel that shows it already stays.
   */
  const reveal = (find: () => HTMLElement, at: number): void =>
    scene.at(at, () => {
      const element = find();
      const card = element.closest<HTMLElement>(".wfe-card") ?? element;
      const body = element.closest<HTMLElement>(".wfe-ins-body");
      if (!body) throw new Error("The element is outside the details.");
      const scroll = revealTween(body, card, designPixel(body) * 12, 0.4);
      if (scroll) scene.run(scroll);
    });

  /** A board button sends the transition at `at`: its row comes in, and the warning goes. */
  const trigger = (at: number): void =>
    scene.at(at, () => {
      // The details render again at once: the summary names the button, the warning goes, and
      // the row of the button shows.
      event.toggleAttribute("data-triggered", true);
      problem.hidden = true;
      triggerRow.hidden = false;
    });

  /** The first frame: no selection, and the transition has no trigger yet. */
  const reset = (): void => {
    set(null);
    untrigger();
  };

  return { reset, open, close, reveal, trigger };
}
