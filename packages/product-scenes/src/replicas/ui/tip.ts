// The tooltip of Tooltip.tsx in a replica root.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";

/** The steps of a tooltip. */
export type Tip = {
  /** Shows `label` under `target`. */
  show: (target: HTMLElement, label: string) => void;
  hide: () => void;
};

/** The tooltip of `root`: it shows under a trigger, kept inside the window as Radix keeps it. */
export function tooltip(root: HTMLElement): Tip {
  const tip = must(root, "[data-tip]");
  const text = must(tip, "[data-tip-text]");
  const arrow = must(tip, "[data-tip-arrow]");

  const show = (target: HTMLElement, label: string): void => {
    text.textContent = label;
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
    gsap.set(tip, { x: left, y: place.y + target.offsetHeight + 5 * pixel });
    gsap.set(arrow, { left: center - left });
  };

  const hide = (): void => {
    tip.hidden = true;
  };

  return { show, hide };
}
