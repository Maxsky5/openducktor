// The duck of the brand links. CSS plays its motion: this script only starts it, so a page
// without product views, such as the 404 page, loads no animation library.
import { all, must } from "../motion/dom";
import { isPausedByVisitor, MOTION_QUERY } from "../motion/preference";

/**
 * The duck of the header brand link hops once when the page opens. Each brand duck bobs on the
 * water when the visitor points at its link or focuses it. A bob that starts plays to its end.
 * Reduced motion keeps the duck still, and no bob starts while the visitor pauses motion.
 */
export function bindBrandMarks(root: Document): void {
  const motion = window.matchMedia(MOTION_QUERY);
  all(root, "[data-brand]").forEach((link, index) => {
    const mark = must(link, "[data-duck]", SVGSVGElement);
    const duck = must(mark, "[data-duck-bob]", SVGGElement);
    duck.addEventListener("animationend", () => {
      delete mark.dataset.play;
    });
    const bob = (): void => {
      if (!motion.matches || isPausedByVisitor() || mark.dataset.play) return;
      mark.dataset.play = "bob";
    };
    link.addEventListener("pointerenter", bob);
    link.addEventListener("focus", bob);
    // The first brand link is the one in the header, at the top of the page.
    if (index === 0 && motion.matches) mark.dataset.play = "hop";
  });
}
