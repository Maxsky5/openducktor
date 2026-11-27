// The tooltip of Tooltip.tsx in a replica root. It opens with the motion of tooltip.css: it fades
// in from 0 and grows from 98 % over 150 ms with ease-out, and it fades out in 50 ms. An open
// tooltip that gets a new label keeps its place in the motion, as Radix changes only its content.
import { must } from "../../motion/dom";
import { designPixel, fadeHide } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds of the open and the close of a tooltip: --tooltip-open-dur and --tooltip-close-dur. */
const OPEN = 0.15;
const CLOSE = 0.05;

/**
 * The side of the trigger where a tooltip shows. TooltipContent of Radix shows on the top side
 * when the product gives no side, but the toolbar buttons of the scenes give `bottom`, so the
 * replica shows there when a step gives no side. A button of a vertical rail gives `right`.
 */
type Side = "top" | "bottom" | "right";

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
    const opening = tip.hidden;
    text.textContent = label;
    tip.dataset.side = side;
    tip.hidden = false;
    const pixel = designPixel(root);
    const place = offsetIn(target, root);
    if (side === "right") {
      const middle = place.y + target.offsetHeight / 2;
      const top = middle - tip.offsetHeight / 2;
      gsap.set(tip, { x: place.x + target.offsetWidth + 5 * pixel, y: top });
      gsap.set(arrow, { clearProps: "left", top: middle - top });
    } else {
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
      gsap.set(arrow, { clearProps: "top", left: center - left });
    }
    if (!opening) return;
    scene.run(
      gsap.fromTo(
        tip,
        { autoAlpha: 0, scale: 0.98 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: OPEN,
          ease: EASE.gentle,
          clearProps: "opacity,visibility",
        },
      ),
    );
  };

  const hide = (): void => {
    scene.run(fadeHide(tip, CLOSE, EASE.gentle));
  };

  return { show, hide };
}
