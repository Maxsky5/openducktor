// The menu of the arrow beside New task in CreateMenu.tsx: a click on the arrow opens the menu
// under it, aligned to its end, and a click on an item closes the menu, as popover-menu.ts does.
import { must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import type { CreateAction } from "./CreateMenu";
import type { Pointer } from "./cursor";
import { popoverMenu } from "./popover-menu";

/** The menu template `menu` of the arrow `trigger` in the window `root`. */
export function createMenu(
  scene: Scene,
  root: HTMLElement,
  cursor: Pointer,
  trigger: HTMLElement,
  menu: HTMLElement,
) {
  const popover = popoverMenu(scene, root, cursor, trigger, menu);
  return {
    /** The visitor clicks the arrow from `at`, and the menu opens. Returns the click time. */
    open: (at: number): number => popover.open(at),
    /**
     * The pointer moves to the item `action` in `travel` seconds from `at` and clicks it, and the
     * menu closes. Returns the time of the click.
     */
    pick: (action: CreateAction, at: number, travel: number): number =>
      popover.pick(() => must(menu, `[data-create-item="${action}"]`), at, travel),
  };
}
