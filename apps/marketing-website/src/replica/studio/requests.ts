// Requests of a task session: a question or an approval docks above the composer,
// and the session start dialog opens over the window.
import { must } from "../../motion/dom";
import { growIn, shrinkOut } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Pointer } from "../shell/pointer";
import { type Request, WAITING } from "../vocabulary";
import { startDialog } from "./start-dialog";

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

  /** Opens the session start dialog of template `name`, and starts the session. */
  const startSession = (name: Template, at: number): number =>
    startDialog(scene, root, cursor, scene.template(name), at);

  return { dock, undock, startSession };
}
