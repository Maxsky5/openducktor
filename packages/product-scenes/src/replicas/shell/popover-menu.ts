// A menu in a popover of the app, such as CreateMenu.tsx or the menu of a task card: a click on its
// trigger opens it under the trigger, aligned to its end with the sideOffset of PopoverContent, and
// a click on an item closes it, as popover.css does.
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Pointer } from "./cursor";

/** The space between the trigger and the menu: sideOffset of popover-content.tsx. */
const SIDE_OFFSET = 6;

/** The menu template `menu` of `trigger` in the window `root`. */
export function popoverMenu(
  scene: Scene,
  root: HTMLElement,
  cursor: Pointer,
  trigger: HTMLElement,
  menu: HTMLElement,
) {
  /**
   * The visitor clicks the trigger from `at`, after `travel` seconds, and the menu opens. Returns
   * the time of the click.
   */
  const open = (at: number, travel = 0.9): number => {
    const opened = cursor.click(() => trigger, at, travel);
    scene.at(opened + 0.05, () => {
      root.append(menu);
      const unit = designPixel(root);
      const anchor = offsetIn(trigger, root);
      const left = anchor.x + trigger.offsetWidth - menu.offsetWidth;
      gsap.set(menu, {
        left: Math.max(8 * unit, left),
        top: anchor.y + trigger.offsetHeight + SIDE_OFFSET * unit,
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
   * The pointer moves to the item of `find` in `travel` seconds from `at` and clicks it, and the
   * menu closes. Returns the time of the click.
   */
  const pick = (find: () => HTMLElement, at: number, travel: number): number => {
    const picked = cursor.click(find, at, travel);
    scene.at(picked - 0.15, () => find().toggleAttribute("data-hover", true));
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
