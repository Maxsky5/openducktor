// The steps of the comments of the CI Checks tab in CommentsList.tsx: an author filter, the Filter
// comments popover and its Hide resolved switch, the scroll of the tab, and a read that brings a
// new comment. The counts follow the cards that the list holds, as countPullRequestComments does.
import { all, must } from "../../motion/dom";
import { designPixel, pop, riseIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { type CommentFilter, commentAge, commentCounts, COMMENT_FILTERS } from "./comments";

/** The controller of the comments in the CI Checks tab of `root`. */
export function ciComments(scene: Scene, root: HTMLElement) {
  const list = must(root, "[data-comments-list]");
  const body = must(root, "[data-checks-body]");
  const menu = must(list, "[data-comments-menu]");
  const menuButton = must(list, "[data-comments-menu-button]");
  const toggle = must(menu, "[data-hide-resolved-switch]");
  const total = must(root, "[data-comments-total]");
  const card = (id: string): HTMLElement => must(list, `[data-comment="${id}"]`);
  const filterButton = (id: CommentFilter): HTMLElement =>
    must(list, `[data-comment-filter="${id}"]`);

  /** Counts the cards that the list holds. A resolved thread counts only when it shows. */
  const count = (): void => {
    const cards = all(list, "[data-comment]").filter((item) => !item.hidden);
    const counts = commentCounts(
      cards.map((item) => ({
        bot: item.hasAttribute("data-bot"),
        resolved: item.hasAttribute("data-resolved"),
      })),
      list.hasAttribute("data-hide-resolved"),
    );
    for (const { id } of COMMENT_FILTERS)
      must(list, `[data-comment-count="${id}"]`).textContent = String(counts[id]);
    total.textContent = String(cards.length);
  };

  /** Selects an author filter. */
  const filter = (id: CommentFilter, at: number): void =>
    scene.at(at, () => {
      list.dataset.filter = id;
      for (const { id: each } of COMMENT_FILTERS)
        filterButton(each).toggleAttribute("data-active", each === id);
    });

  /** Opens or closes the Filter comments popover. */
  const openMenu = (opened: boolean, at: number): void =>
    scene.at(at, () => {
      menu.hidden = !opened;
      if (opened)
        scene.run(
          gsap.fromTo(
            menu,
            { autoAlpha: 0, y: -4 * designPixel(root) },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.15,
              ease: EASE.enter,
              clearProps: "opacity,visibility,transform",
            },
          ),
        );
    });

  /** Turns Hide resolved on or off. The counts follow at once. */
  const hideResolved = (hidden: boolean, at: number): void =>
    scene.at(at, () => {
      toggle.toggleAttribute("data-checked", hidden);
      list.toggleAttribute("data-hide-resolved", hidden);
      count();
    });

  /** Scrolls the tab so that `target` shows near its top. Returns the end of the scroll. */
  const scrollTo = (target: () => HTMLElement | null, at: number, duration = 0.9): number => {
    scene.at(at, () => {
      const element = target();
      const top = element
        ? element.getBoundingClientRect().top -
          body.getBoundingClientRect().top +
          body.scrollTop -
          12 * designPixel(root)
        : 0;
      const end = gsap.utils.clamp(0, body.scrollHeight - body.clientHeight, top);
      scene.run(gsap.to(body, { scrollTop: end, duration, ease: EASE.move }));
    });
    return at + duration;
  };

  /** Shows the comments of a read at `now`: a new card, the counts, and the relative times. */
  const read = (now: string, added: string, at: number): void =>
    scene.at(at, () => {
      const item = card(added);
      item.hidden = false;
      for (const time of all(list, "[data-age]")) {
        time.textContent = commentAge(time.dataset.age ?? "", now);
      }
      count();
      scene.run(riseIn(item, 6 * designPixel(root)));
      scene.run(pop(filterButton("all"), 1.08));
    });

  /** Sets the state of the first frame. */
  const reset = (later: readonly string[], now: string): void => {
    for (const id of later) card(id).hidden = true;
    menu.hidden = true;
    toggle.removeAttribute("data-checked");
    list.removeAttribute("data-hide-resolved");
    for (const time of all(list, "[data-age]"))
      time.textContent = commentAge(time.dataset.age ?? "", now);
    count();
  };

  return {
    card,
    filterButton,
    menuButton,
    toggle,
    filter,
    openMenu,
    hideResolved,
    scrollTo,
    read,
    reset,
  };
}
