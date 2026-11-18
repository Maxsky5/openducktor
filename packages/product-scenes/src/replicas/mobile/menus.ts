// The menus of ActionMenu.tsx and QuickActionsMenu.tsx in the display of a phone. A menu opens
// next to its trigger, as placePopover of popover-placement.ts places it: below the trigger, or
// above it when it fits only there, aligned with the trigger edge nearer to the screen edge. As
// useAnchoredPopover of anchored-popover.tsx, one progress moves the card and the scrim on
// `motion.easeOutCurve`: the card grows from 94 % at the corner next to the trigger and fades in,
// and it shrinks and fades out when it closes. The progress is `--menu-progress` of the layer, and
// the stylesheets of the menus take the opacity and the scale of the card and the scrim from it.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { APP_EASE_OUT } from "./app-motion";

/** The space between the card and the screen edges, and between the card and its trigger. */
const EDGE = 12;
const GAP = 6;

/** Seconds that the progress takes to open and to close the menu. */
const OPEN = 0.16;
const CLOSE = 0.11;

/** The menus of the phone in `root`. */
export function menus(scene: Scene, root: HTMLElement) {
  const display = must(root, "[data-display]");
  const layerOf = (name: string): HTMLElement => must(display, `[data-menu="${name}"]`);

  /** The action `id` of the menu `name`. */
  const item = (name: string, id: string): HTMLElement =>
    must(layerOf(name), `[data-menu-item="${id}"]`);

  /** Opens the menu `name` next to the trigger that `find` returns at `at`. */
  const open = (name: string, find: () => HTMLElement, at: number): number => {
    scene.at(at, () => {
      const layer = layerOf(name);
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
      // The stylesheet moves the card to `--menu-x` and `--menu-y`, then scales it from its corner
      // next to the trigger.
      card.style.setProperty("--menu-x", `${left}px`);
      card.style.setProperty("--menu-y", `${top}px`);
      card.style.transformOrigin = `${fits ? "top" : "bottom"} ${right ? "right" : "left"}`;
      scene.run(
        gsap.fromTo(
          layer,
          { "--menu-progress": 0 },
          { "--menu-progress": 1, duration: OPEN, ease: APP_EASE_OUT },
        ),
      );
    });
    return at + OPEN;
  };

  /** Closes the menu `name` at `at`, as a chosen action closes it. */
  const close = (name: string, at: number): number => {
    scene.at(at, () => {
      const layer = layerOf(name);
      scene.run(
        gsap.to(layer, {
          "--menu-progress": 0,
          duration: CLOSE,
          ease: APP_EASE_OUT,
          onComplete: () => {
            layer.hidden = true;
          },
        }),
      );
    });
    return at + CLOSE;
  };

  return { item, open, close };
}
