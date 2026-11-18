// The menus of ActionMenu.tsx and QuickActionsMenu.tsx in the display of a phone. A menu opens
// next to its trigger, as placePopover of popover-placement.ts places it: below the trigger, or
// above it when it fits only there, aligned with the trigger edge nearer to the screen edge. As
// useAnchoredPopover of anchored-popover.tsx, one progress moves the card and the scrim: the card
// grows from 94 % at the corner next to the trigger and fades in, and it shrinks and fades out
// when it closes. The progress is `--menu-progress` of the layer, so a scrim can fade with it, as
// the scrim of QuickActionsMenu.css does.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** The space between the card and the screen edges, and between the card and its trigger. */
const EDGE = 12;
const GAP = 6;

/** Seconds that the progress takes to open and to close the menu, on one ease-out curve. */
const OPEN = 0.16;
const CLOSE = 0.11;

/** The scale of the card when it is closed. */
const CLOSED_SCALE = 0.94;

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
        gsap
          .timeline()
          .fromTo(
            card,
            {
              autoAlpha: 0,
              scale: CLOSED_SCALE,
              transformOrigin: `${fits ? "top" : "bottom"} ${right ? "right" : "left"}`,
            },
            { autoAlpha: 1, scale: 1, duration: OPEN, ease: EASE.arrive },
            0,
          )
          .fromTo(
            layer,
            { "--menu-progress": 0 },
            { "--menu-progress": 1, duration: OPEN, ease: EASE.arrive },
            0,
          ),
      );
    });
    return at + OPEN;
  };

  /** Closes the menu `name` at `at`, as a chosen action closes it. */
  const close = (name: string, at: number): number => {
    scene.at(at, () => {
      const layer = must(display, `[data-menu="${name}"]`);
      scene.run(
        gsap
          .timeline({
            onComplete: () => {
              layer.hidden = true;
            },
          })
          .to(
            must(layer, "[data-menu-card]"),
            { autoAlpha: 0, scale: CLOSED_SCALE, duration: CLOSE, ease: EASE.arrive },
            0,
          )
          .to(layer, { "--menu-progress": 0, duration: CLOSE, ease: EASE.arrive }, 0),
      );
    });
    return at + CLOSE;
  };

  return { item, open, close };
}
