// The keystrokes of the palette scene in KeyHud.astro: each press shows its keys, which dip as
// they go down, then fade out.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** The key overlay of the stage of `scene`. */
export function keystrokes(scene: Scene) {
  const hud = must(scene.stage, "[data-keys]");

  /** Shows the keys of one press at `at`, and fades them out at `until`. */
  const press = (keys: readonly string[], at: number, until = at + 0.8): void => {
    scene.at(at, () => {
      hud.replaceChildren(
        ...keys.map((key) => {
          const cap = document.createElement("kbd");
          cap.textContent = key;
          return cap;
        }),
      );
      hud.hidden = false;
      scene.run(
        gsap.fromTo(
          hud,
          { autoAlpha: 0, y: 10 },
          { autoAlpha: 1, y: 0, duration: 0.18, ease: EASE.arrive, overwrite: true },
        ),
      );
      scene.run(
        gsap.fromTo(
          hud.children,
          { y: 0, scale: 1 },
          {
            y: 3,
            scale: 0.94,
            duration: 0.08,
            yoyo: true,
            repeat: 1,
            stagger: 0.05,
            ease: EASE.gentle,
          },
        ),
      );
    });
    scene.at(until, () => {
      scene.run(gsap.to(hud, { autoAlpha: 0, duration: 0.25, ease: EASE.exit }));
    });
  };

  return { press };
}
