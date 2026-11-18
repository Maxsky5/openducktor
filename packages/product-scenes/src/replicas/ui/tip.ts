// The tooltip of Tooltip.tsx in a replica root. It opens with the motion of tooltip.css: it fades
// in from 98 % over 150 ms with ease-out, and it closes in 50 ms.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";

/** Seconds of the open and the close of a tooltip: --tooltip-open-dur and --tooltip-close-dur. */
const OPEN = 0.15;
const CLOSE = 0.05;

/**
 * The side of the trigger where a tooltip shows. TooltipContent of Radix shows on the top side
 * when the product gives no side.
 */
type Side = "top" | "bottom";

/** The steps of a tooltip. */
export type Tip = {
  /** Shows `label` on the `side` of `target`. */
  show: (target: HTMLElement, label: string, side?: Side) => void;
  hide: () => void;
};

/**
 * The tooltip of `root`: it shows next to a trigger, kept inside the window as Radix keeps it. Call
 * `show` and `hide` in a change of the scene.
 */
export function tooltip(scene: Scene, root: HTMLElement): Tip {
  const tip = must(root, "[data-tip]");
  const text = must(tip, "[data-tip-text]");
  const arrow = must(tip, "[data-tip-arrow]");

  const show = (target: HTMLElement, label: string, side: Side = "bottom"): void => {
    text.textContent = label;
    tip.dataset.side = side;
    tip.hidden = false;
    const pixel = designPixel(root);
    const place = offsetIn(target, root);
    const center = place.x + target.offsetWidth / 2;
    const edge = 4 * pixel;
    const left = gsap.utils.clamp(
      edge,
      root.clientWidth - tip.offsetWidth - edge,
      center - tip.offsetWidth / 2,
    );
    const top =
      side === "top"
        ? place.y - tip.offsetHeight - 5 * pixel
        : place.y + target.offsetHeight + 5 * pixel;
    gsap.set(tip, { x: left, y: top });
    gsap.set(arrow, { left: center - left });
    scene.run(
      gsap.fromTo(
        tip,
        { opacity: 0, scale: 0.98 },
        { opacity: 1, scale: 1, duration: OPEN, ease: "power1.out", clearProps: "opacity" },
      ),
    );
  };

  const hide = (): void => {
    scene.run(
      gsap.to(tip, {
        opacity: 0,
        duration: CLOSE,
        ease: "power1.out",
        onComplete: () => {
          tip.hidden = true;
          gsap.set(tip, { clearProps: "opacity" });
        },
      }),
    );
  };

  return { show, hide };
}
