// The pager of TaskBoard.tsx. A swipe moves the board one lane to the left or the right. While the
// finger moves, the pages, the selection pill, and the lane titles follow it through
// `--lane-progress`. The pill outline and the board wash mix the colors of the lane that they
// leave into the colors of the next lane through `--tone-mix`, as interpolateColor mixes them with
// the page progress. When the page settles, the lane is selected and the rail scrolls to center
// its cell, as board-pager.tsx and board-lane-switcher.tsx do.
import { all, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { PHONE_LANES, railScroll } from "./LaneSwitcher";

/** Seconds that the touch rests on the board before it drags. */
const REST = 0.2;

/** Seconds of the drag, from the first move of the finger to the settled page. */
const DRAG = 0.7;

/** The board of the Tasks tab in `root`. */
export function boardPager(scene: Scene, root: HTMLElement) {
  const display = must(root, "[data-display]");
  const touch = must(display, "[data-touch]");
  const lanes = must(root, "[data-lanes]");
  const board = must(root, "[data-board]");
  const pages = must(root, "[data-board-pages]");
  const pill = must(lanes, "[data-lane-pill]");
  const cells = all(lanes, "[data-lane-cell]");

  /** Selects lane `index` at once, as the board shows it after a swipe. */
  const select = (index: number): void => {
    const tone = PHONE_LANES[index]?.tone ?? "neutral";
    for (const element of [lanes, pages]) element.style.setProperty("--lane-progress", `${index}`);
    lanes.style.setProperty("--rail-scroll", `${railScroll(index)}`);
    pill.dataset.tone = tone;
    board.dataset.tone = tone;
    cells.forEach((cell, position) => cell.toggleAttribute("data-selected", position === index));
  };

  /**
   * The finger touches the board at `at` in the empty space under the cards, rests a moment, and
   * drags the board from lane `from` to the next lane. Returns the time when the page settles.
   */
  const swipe = (from: number, to: number, at: number): number => {
    const tone = PHONE_LANES[to]?.tone ?? "neutral";
    scene.at(at, () => {
      const unit = designPixel(display);
      const start = offsetIn(board, display);
      const y = start.y + board.offsetHeight * 0.65;
      const right = start.x + board.offsetWidth * 0.8;
      const reach = 220 * unit * Math.sign(to - from);
      scene.run(
        gsap
          .timeline()
          .set(touch, { x: right, y })
          .fromTo(touch, { autoAlpha: 0, scale: 1.2 }, { autoAlpha: 1, scale: 1, duration: 0.12 })
          .to(touch, { x: right - reach, duration: DRAG * 0.75, ease: EASE.move }, REST)
          .to(touch, { autoAlpha: 0, duration: 0.15, ease: EASE.exit }, REST + DRAG * 0.75),
      );
      // The outline and the wash keep the colors that they leave, and mix in the next lane.
      const toned = [pill, board];
      pill.style.setProperty("--tone-from", getComputedStyle(pill).borderTopColor);
      board.style.setProperty("--tone-from", getComputedStyle(board).backgroundColor);
      for (const element of toned) element.dataset.tone = tone;
      scene.run(
        gsap
          .timeline({
            defaults: { duration: DRAG, ease: EASE.move },
            onComplete: () => {
              for (const element of toned) {
                element.style.removeProperty("--tone-from");
                element.style.removeProperty("--tone-mix");
              }
            },
          })
          .fromTo([lanes, pages], { "--lane-progress": from }, { "--lane-progress": to }, REST)
          .fromTo(toned, { "--tone-mix": 0 }, { "--tone-mix": 1 }, REST),
      );
    });
    const settled = at + REST + DRAG;
    scene.at(settled, () => select(to));
    return settled;
  };

  return { select, swipe };
}
