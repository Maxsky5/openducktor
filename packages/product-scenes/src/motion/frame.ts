import { gsap } from "./gsap";
import { EASE } from "./tokens";

/** The last frame of a stage, with the scroll offsets of its parts. */
export type Frame = {
  stage: HTMLElement;
  scrolled: { element: Element; top: number; left: number }[];
};

/**
 * Records the last frame of `stage`. The frame stays in the stage until `showFrame` moves it. Take
 * the frame while the stage shows: a hidden element and a moved element lose their scroll
 * offsets, so the frame records them first.
 */
export function takeFrame(stage: HTMLElement): Frame {
  const scrolled = [...stage.querySelectorAll("*")]
    .filter((element) => element.scrollTop > 0 || element.scrollLeft > 0)
    .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  return { stage, scrolled };
}

/**
 * Moves a frame out of its stage into a cover over `target`, at the place of `target`, where it
 * keeps its scroll offsets. The cover keeps the inline styles of its frame, and it has no role, so
 * a screen reader and the scene scripts do not find it. The cover takes its place before the frame
 * leaves its stage, and the stage keeps its height while the frame moves, so the page does not
 * scroll. The caller fills the empty stage at once.
 */
export function showFrame({ stage, scrolled }: Frame, target: HTMLElement): HTMLElement {
  const box = target.getBoundingClientRect();
  const cover = stage.cloneNode(false);
  if (!(cover instanceof HTMLElement)) throw new Error("The stage clone is not an element.");
  for (const name of ["data-stage", "role", "aria-label", "id"]) cover.removeAttribute(name);
  cover.setAttribute("aria-hidden", "true");
  cover.inert = true;
  cover.dataset.stageCover = "";
  Object.assign(cover.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: "0",
  });
  target.after(cover);
  // The containing block of the cover can be any ancestor, so measure from its own origin.
  const origin = cover.getBoundingClientRect();
  cover.style.left = `${box.left - origin.left}px`;
  cover.style.top = `${box.top - origin.top}px`;
  // The scroll offsets lay out the page, so the empty stage keeps the height of its frame.
  stage.style.minHeight = `${stage.offsetHeight}px`;
  cover.append(...stage.childNodes);
  for (const { element, top, left } of scrolled) {
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  stage.style.minHeight = "";
  return cover;
}

/**
 * A paused fade from a cover to the empty background, then from the background to `stage`. The
 * stage hides at once, so the two frames never show together. The cover leaves the page when
 * the stage shows in full. A kill before the end shows the stage again.
 */
export function fadeThrough(
  cover: HTMLElement,
  stage: HTMLElement,
  duration: number,
  done: () => void,
): gsap.core.Timeline {
  gsap.set(stage, { opacity: 0 });
  return gsap
    .timeline({
      paused: true,
      onComplete: () => {
        cover.remove();
        gsap.set(stage, { clearProps: "opacity" });
        done();
      },
      onInterrupt: () => gsap.set(stage, { clearProps: "opacity" }),
    })
    .to(cover, { autoAlpha: 0, duration, ease: EASE.dismiss })
    .to(stage, { opacity: 1, duration, ease: EASE.gentle });
}

/** A paused fade of a cover. The cover leaves the page when the fade ends. */
export function fadeOut(cover: HTMLElement, duration: number, done: () => void): gsap.core.Tween {
  return gsap.to(cover, {
    autoAlpha: 0,
    duration,
    ease: EASE.fade,
    paused: true,
    onComplete: () => {
      cover.remove();
      done();
    },
  });
}
