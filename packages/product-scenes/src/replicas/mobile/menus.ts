// The menus of ActionMenu.tsx in the display of a phone. A menu opens next to its trigger, as
// placePopover of popover-placement.ts places it: below the trigger, or above it when it fits only
// there, aligned with the trigger edge nearer to the screen edge. It grows from the corner next to
// the trigger and fades out when it closes.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** The space between the card and the screen edges, and between the card and its trigger. */
const EDGE = 12;
const GAP = 6;

/** The menus of the phone in `root`. */
export function menus(scene: Scene, root: HTMLElement) {
  const display = must(root, "[data-display]");

  /** The action `id` of the menu `name`. */
  const item = (name: string, id: string): HTMLElement =>
    must(display, `[data-menu="${name}"] [data-menu-item="${id}"]`);

  /** Opens the menu `name` next to the trigger that `find` returns at `at`. */
  const open = (name: string, find: () => HTMLElement, at: number): number => {
    scene.at(at, () => {
      const layer = must(display, `[data-menu="${name}"]`);
      const card = must(layer, "[data-menu-card]");
      layer.hidden = false;
      const unit = designPixel(root);
      const trigger = find();
      const point = offsetIn(trigger, display);
      const right = point.x + trigger.offsetWidth / 2 > display.offsetWidth / 2;
      const raw = right ? point.x + trigger.offsetWidth - card.offsetWidth : point.x;
      const left = Math.min(
        Math.max(EDGE * unit, raw),
        display.offsetWidth - card.offsetWidth - EDGE * unit,
      );
      const below = point.y + trigger.offsetHeight + GAP * unit;
      const fits = below + card.offsetHeight <= display.offsetHeight - EDGE * unit;
      const top = fits ? below : point.y - GAP * unit - card.offsetHeight;
      gsap.set(card, { x: left, y: top });
      scene.run(
        gsap.fromTo(
          card,
          {
            autoAlpha: 0,
            scale: 0.92,
            transformOrigin: `${fits ? "top" : "bottom"} ${right ? "right" : "left"}`,
          },
          { autoAlpha: 1, scale: 1, duration: 0.2, ease: EASE.arrive },
        ),
      );
    });
    return at + 0.2;
  };

  /** Closes the menu `name` at `at`, as a chosen action closes it. */
  const close = (name: string, at: number): number => {
    scene.at(at, () => {
      const layer = must(display, `[data-menu="${name}"]`);
      scene.run(
        gsap.to(must(layer, "[data-menu-card]"), {
          autoAlpha: 0,
          duration: 0.15,
          ease: EASE.exit,
          onComplete: () => {
            layer.hidden = true;
          },
        }),
      );
    });
    return at + 0.15;
  };

  return { item, open, close };
}
