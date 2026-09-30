// Requests of a session in the Agent Studio: a question or an approval docks above the composer,
// and the session start dialog opens over the window.
import { must } from "../../motion/dom";
import { designPixel, fadeIn, growIn, shrinkOut } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Pointer } from "../shell/pointer";
import { type Request, WAITING } from "../vocabulary";

/** The requests of the window `root`. The dialogs and the request cards are templates of the view. */
export function studioRequests<Template extends string>(
  scene: Scene<Template>,
  root: HTMLElement,
  cursor: Pointer,
) {
  const stack = must(root, "[data-stack]");
  const composer = must(root, "[data-composer]");

  /** Docks the request of template `kind` above the composer. Returns the card. */
  const dock = (kind: Extract<Request, Template>, at: number): HTMLElement => {
    const item = scene.template(kind);
    scene.at(at, () => {
      must(composer, "[data-waiting]").textContent = WAITING[kind];
      stack.append(item);
      const padding = getComputedStyle(stack).paddingTop;
      scene.run(
        gsap.fromTo(
          stack,
          { paddingTop: 0 },
          { paddingTop: padding, duration: 0.4, ease: EASE.enter, clearProps: "paddingTop" },
        ),
      );
      scene.run(growIn(item));
    });
    return item;
  };

  /** Removes a docked card. Returns the end time. */
  const undock = (item: HTMLElement, at: number): number => {
    scene.at(at, () => {
      scene.run(shrinkOut(item));
      scene.run(
        gsap.to(stack, {
          paddingTop: 0,
          duration: 0.35,
          ease: EASE.exit,
          onComplete: () => gsap.set(stack, { clearProps: "paddingTop" }),
        }),
      );
    });
    return at + 0.35;
  };

  /** Opens a session start dialog, clicks Start session, and closes it. Returns the close time. */
  const startSession = (name: Template, at: number): number => {
    const overlay = scene.template(name);
    const box = must(overlay, "[data-dialog-box]");
    scene.at(at, () => {
      root.append(overlay);
      scene.run(fadeIn(overlay, 0.25));
      scene.run(
        gsap.fromTo(
          box,
          { autoAlpha: 0, scale: 0.96, y: 8 * designPixel(root) },
          { autoAlpha: 1, scale: 1, y: 0, duration: 0.35, ease: EASE.arrive },
        ),
      );
    });
    const started = cursor.click(() => must(overlay, "[data-start]"), at + 1.1, 1);
    scene.at(started + 0.25, () =>
      scene.run(
        gsap.to(overlay, {
          autoAlpha: 0,
          duration: 0.25,
          ease: EASE.dismiss,
          onComplete: () => overlay.remove(),
        }),
      ),
    );
    return started + 0.5;
  };

  return { dock, undock, startSession };
}
