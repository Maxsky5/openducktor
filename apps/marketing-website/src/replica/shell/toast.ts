// The in-app notifications of the desktop app: Toast.astro draws one notification.
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

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
    stack.append(toast);
    scene.run(
      gsap.fromTo(
        toast,
        { autoAlpha: 0, y: 18, scale: 0.98 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: EASE.arrive },
      ),
    );
  });
  scene.at(at + hold, () => {
    scene.run(
      gsap.to(toast, {
        autoAlpha: 0,
        x: 24,
        duration: 0.35,
        ease: EASE.exit,
        onComplete: () => toast.remove(),
      }),
    );
  });
}
