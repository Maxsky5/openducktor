// The in-app notifications of the desktop app: Toast.tsx draws one notification. The stack moves
// as the expanded Sonner toaster of components/ui/sonner.tsx at the bottom right: a notification
// slides up from its own height below its place and fades in, the notifications above it move up
// at the same time, and a notification that goes slides down and fades out.
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds of each move of a notification: the transform transition of a Sonner toast. */
const MOVE = 0.4;

/** The ease of the Sonner transitions: the CSS `ease` curve, close to a quadratic ease out. */
const SONNER_EASE = EASE.gentle;

/**
 * Runs `change`, which adds a notification to `stack` or removes one, and moves the other
 * notifications from their places before the change to their new places. The stack keeps its
 * bottom edge, so a change moves the top of the stack.
 */
function restack(scene: Scene, stack: HTMLElement, change: () => void): void {
  const topOf = (child: HTMLElement): number => stack.offsetTop + child.offsetTop;
  const before = [...stack.children].flatMap((child) =>
    child instanceof HTMLElement
      ? [{ child, top: topOf(child) + Number(gsap.getProperty(child, "y")) }]
      : [],
  );
  change();
  for (const { child, top } of before) {
    if (!child.isConnected) continue;
    const shift = top - topOf(child);
    if (Math.abs(shift) < 0.5) continue;
    scene.run(
      gsap.fromTo(
        child,
        { y: shift },
        { y: 0, duration: MOVE, ease: SONNER_EASE, overwrite: "auto" },
      ),
    );
  }
}

/** Slides the notification of template `name` into `stack`, then out after `hold` seconds. */
export function notify<Template extends string>(
  scene: Scene<Template>,
  stack: HTMLElement,
  name: Template,
  at: number,
  hold = 3.2,
): void {
  const toast = scene.template(name);
  scene.at(at, () => {
    restack(scene, stack, () => stack.append(toast));
    scene.run(
      gsap.fromTo(
        toast,
        { autoAlpha: 0, yPercent: 100 },
        { autoAlpha: 1, yPercent: 0, duration: MOVE, ease: SONNER_EASE },
      ),
    );
  });
  scene.at(at + hold, () => {
    scene.run(gsap.to(toast, { autoAlpha: 0, yPercent: 100, duration: MOVE, ease: SONNER_EASE }));
  });
  scene.at(at + hold + MOVE, () => restack(scene, stack, () => toast.remove()));
}
