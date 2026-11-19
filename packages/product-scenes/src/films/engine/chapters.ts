// The chapter bar of a film: one item for each chapter, with a bar that fills while the chapter
// plays. The current chapter shows in full, and the other chapters are dim.
import { all, must } from "../../motion/dom";

export type Chapters = {
  /** Makes the chapter `index` current from `at`, and fills its bar until `end`. */
  play: (index: number, at: number, end: number) => void;
  /** Shows the bar from `at`. */
  show: (at: number) => void;
  /** Hides the bar from `at`. */
  hide: (at: number) => void;
};

export function chapterBar(timeline: gsap.core.Timeline, root: HTMLElement): Chapters {
  const bar = must(root, "[data-film-chapters]");
  const items = all(bar, "[data-film-chapter]");
  const fillOf = (item: HTMLElement): HTMLElement => must(item, "[data-film-chapter-fill]");

  const play = (index: number, at: number, end: number): void => {
    const current = items[index];
    if (!current) throw new Error(`The film has no chapter ${index}.`);
    items.forEach((item, position) => {
      if (position < index) timeline.set(fillOf(item), { scaleX: 1 }, at);
      timeline.set(item, { attr: { "data-current": position === index ? "true" : "false" } }, at);
    });
    timeline.fromTo(
      fillOf(current),
      { scaleX: 0 },
      { scaleX: 1, duration: end - at, ease: "none", immediateRender: false },
      at,
    );
  };

  const show = (at: number): void => {
    timeline.fromTo(
      bar,
      { autoAlpha: 0, y: 12 },
      { autoAlpha: 1, y: 0, duration: 0.6, ease: "power2.out", immediateRender: false },
      at,
    );
  };

  const hide = (at: number): void => {
    timeline.to(bar, { autoAlpha: 0, y: 12, duration: 0.5, ease: "power2.in" }, at);
  };

  return { play, show, hide };
}
