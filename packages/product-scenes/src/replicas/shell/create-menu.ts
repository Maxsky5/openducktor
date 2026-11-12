// The menu of the arrow beside New task in CreateMenu.tsx: a click on the arrow opens the menu
// under it, aligned to its end, and a click on an item closes the menu, as popover.css does.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { CreateAction } from "./CreateMenu";
import type { Pointer } from "./cursor";

/** The menu template `menu` of the arrow `trigger` in the window `root`. */
export function createMenu(
  scene: Scene,
  root: HTMLElement,
  cursor: Pointer,
  trigger: HTMLElement,
  menu: HTMLElement,
) {
  /** The visitor clicks the arrow from `at`, and the menu opens. Returns the time of the click. */
  const open = (at: number): number => {
    const opened = cursor.click(() => trigger, at, 0.9);
    scene.at(opened + 0.05, () => {
      root.append(menu);
      const unit = designPixel(root);
      const anchor = offsetIn(trigger, root);
      const left = anchor.x + trigger.offsetWidth - menu.offsetWidth;
      gsap.set(menu, {
        left: Math.max(8 * unit, left),
        top: anchor.y + trigger.offsetHeight + 6 * unit,
      });
      scene.run(
        gsap.fromTo(
          menu,
          { autoAlpha: 0, scale: 0.96, transformOrigin: "top right" },
          { autoAlpha: 1, scale: 1, duration: 0.2, ease: EASE.arrive },
        ),
      );
    });
    return opened;
  };

  /**
   * The pointer moves to the item `action` in `travel` seconds from `at` and clicks it, and the
   * menu closes. Returns the time of the click.
   */
  const pick = (action: CreateAction, at: number, travel: number): number => {
    const item = (): HTMLElement => must(menu, `[data-create-item="${action}"]`);
    const picked = cursor.click(item, at, travel);
    scene.at(picked - 0.15, () => item().toggleAttribute("data-hover", true));
    scene.at(picked + 0.05, () =>
      scene.run(
        gsap.to(menu, {
          autoAlpha: 0,
          scale: 0.99,
          duration: 0.15,
          ease: EASE.arrive,
          onComplete: () => menu.remove(),
        }),
      ),
    );
    return picked;
  };

  return { open, pick };
}
