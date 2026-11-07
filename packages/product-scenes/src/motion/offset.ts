// The position of an element in the layout of a replica. It reads the GSAP translations, so only
// the scene scripts import it.
import { gsap } from "./gsap";

/** A point in the layout of a replica, in unscaled CSS pixels. */
export type Point = { x: number; y: number };

/**
 * Layout position of `element` inside `root`, in unscaled CSS pixels. It adds GSAP translations
 * and removes the scroll offsets of the positioned ancestors.
 */
export function offsetIn(element: HTMLElement, root: HTMLElement): Point {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && node !== root) {
    x += node.offsetLeft + Number(gsap.getProperty(node, "x"));
    y += node.offsetTop + Number(gsap.getProperty(node, "y"));
    const parent: Element | null = node.offsetParent;
    node = parent instanceof HTMLElement ? parent : null;
    if (node && node !== root) {
      x += node.clientLeft - node.scrollLeft;
      y += node.clientTop - node.scrollTop;
    }
  }
  if (node !== root) throw new Error("Scene element is outside its positioned root.");
  return { x, y };
}
