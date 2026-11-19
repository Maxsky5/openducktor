// The horizontal scroll of the Kanban board of Board.tsx: the scroll that shows a lane or a card,
// at once when a scene builds its first frame, or in a tween.
import { all } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** The board scroll that shows all of `element`, like the horizontal scroll of the board. */
export function scrollFor(track: HTMLElement, element: HTMLElement): number {
  const viewport = track.parentElement;
  if (!viewport) throw new Error("Board track needs a viewport.");
  const pad = Number.parseFloat(getComputedStyle(track).paddingLeft);
  const width = viewport.clientWidth;
  const max = Math.max(0, track.scrollWidth - width);
  const left = element.offsetLeft - pad;
  const right = element.offsetLeft + element.offsetWidth + pad;
  let next = -Number(gsap.getProperty(track, "x"));
  if (right > next + width) next = right - width;
  if (left < next) next = left;
  next = Math.min(max, Math.max(0, next));
  return track.hasAttribute("data-whole-lanes")
    ? wholeLaneScroll(track, next, { left, right, width, max, pad })
    : next;
}

/** The scroll limits of the board, and the target edges with the track padding. */
type ScrollView = { left: number; right: number; width: number; max: number; pad: number };

/**
 * The scroll nearest `next` where no lane crosses an edge of the viewport, and the target still
 * shows. A board with `data-whole-lanes` uses it.
 */
function wholeLaneScroll(track: HTMLElement, next: number, view: ScrollView): number {
  const lanes = all(track, "[data-lane]").map((lane) => ({
    left: lane.offsetLeft,
    right: lane.offsetLeft + lane.offsetWidth,
  }));
  const candidates = [0, view.max];
  for (const lane of lanes) {
    for (let gap = 0; gap <= view.pad; gap += 1) {
      candidates.push(lane.left - gap, lane.right + gap - view.width);
    }
  }
  const cutsNoLane = (start: number): boolean => {
    const end = start + view.width;
    return lanes.every(
      (lane) =>
        lane.right <= start || lane.left >= end || (lane.left >= start && lane.right <= end),
    );
  };
  const clean = candidates.filter(
    (start) =>
      start >= 0 &&
      start <= view.max &&
      start <= view.left + view.pad &&
      start + view.width >= view.right - view.pad &&
      cutsNoLane(start),
  );
  return clean.reduce(
    (best, start) => (Math.abs(start - next) < Math.abs(best - next) ? start : best),
    clean[0] ?? next,
  );
}

/** Build time: the board scrolls at once, so all of `element` shows in the first frame. */
export function showOnBoard(track: HTMLElement, element: HTMLElement): void {
  gsap.set(track, { x: -scrollFor(track, element) });
}

/** Scrolls the board so all of `element` shows. */
export function scrollBoardTo(
  scene: Scene,
  track: HTMLElement,
  element: HTMLElement,
  at: number,
  duration = 0.8,
): void {
  scene.at(at, () => {
    const next = scrollFor(track, element);
    if (Math.abs(next + Number(gsap.getProperty(track, "x"))) < 1) return;
    scene.run(gsap.to(track, { x: -next, duration, ease: EASE.move }));
  });
}
