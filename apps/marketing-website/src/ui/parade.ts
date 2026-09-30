import { all, must } from "../motion/dom";
import { gsap } from "../motion/gsap";
import { watchPlayback, whileMotionAllowed } from "../motion/player";
import { EASE } from "../motion/tokens";

/** The parade plays from the moment its top passes 85% of the screen height until it leaves. */
const PARADE_ZONE = { start: "top 85%", end: "bottom top" };

/**
 * The duck parade of the closing section. The ducks swim in once, the first time the parade
 * comes into view. Then they float, the water moves, and a light scans the visor of the lead duck
 * while the parade is on screen. The pause control stops all of it.
 */
export function mountParade(): void {
  const root = must(document, "[data-parade]");
  const train = must(root, "[data-parade-train]", SVGGElement);
  const ducks = all(root, "[data-parade-duck]", SVGGElement);
  const light = must(root, "[data-parade-light]", SVGPathElement);
  const wave = must(root, "[data-parade-wave]", SVGPathElement);
  whileMotionAllowed(() => {
    const arrive = gsap
      .timeline({ paused: true })
      .from(train, { x: -150, duration: 2.6, ease: EASE.enter })
      .from(
        ducks,
        {
          rotation: -8,
          transformOrigin: "50% 100%",
          duration: 0.5,
          ease: EASE.float,
          yoyo: true,
          repeat: 4,
          stagger: 0.12,
        },
        0,
      );
    // The ducks float out of step, so the row does not move as one block.
    const float = gsap.timeline({ paused: true });
    ducks.forEach((duck, index) => {
      float.to(
        duck,
        {
          y: -1.5,
          rotation: index % 2 ? 2.5 : -2.5,
          transformOrigin: "50% 100%",
          duration: 1.4 + index * 0.25,
          ease: EASE.float,
          yoyo: true,
          repeat: -1,
        },
        0,
      );
    });
    float.to(wave, { x: -24, duration: 1.8, ease: EASE.steady, repeat: -1 }, 0);
    // The light scans the visor of the lead duck now and then.
    float.add(
      gsap
        .timeline({ repeat: -1, repeatDelay: 3 })
        .to(light, { x: -8, duration: 0.6, ease: EASE.float }, 1)
        .to(light, { x: 0, duration: 0.6, ease: EASE.float }),
      0,
    );
    let running = false;
    const sync = (value: boolean): void => {
      running = value;
      if (!running) {
        arrive.pause();
        float.pause();
      } else if (arrive.progress() < 1) {
        arrive.play();
      } else {
        float.play();
      }
    };
    arrive.eventCallback("onComplete", () => sync(running));
    const stopWatch = watchPlayback(root, sync, PARADE_ZONE);
    return () => {
      stopWatch();
      arrive.kill();
      float.kill();
      gsap.set([train, ...ducks, light, wave], { clearProps: "all" });
    };
  });
}
