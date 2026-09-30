import { gsap } from "./gsap";
import { EASE } from "./tokens";

/** The last frame of a stage, moved out of the stage with the scroll offsets of its parts. */
export type Frame = {
  cover: HTMLElement;
  scrolled: { element: Element; top: number; left: number }[];
};

/**
 * Moves the content of `stage` into a detached cover, so the stage can load another frame. The
 * cover keeps the inline styles of its frame, and it has no role, so a screen reader and the
 * scene scripts do not find it. Take the frame while the stage shows: a hidden element and a
 * moved element lose their scroll offsets, so the frame records them first.
 */
export function takeFrame(stage: HTMLElement): Frame {
  const cover = stage.cloneNode(false);
  if (!(cover instanceof HTMLElement)) throw new Error("The stage clone is not an element.");
  for (const name of ["data-stage", "role", "aria-label", "id"]) cover.removeAttribute(name);
  cover.setAttribute("aria-hidden", "true");
  cover.inert = true;
  cover.dataset.stageCover = "";
  const scrolled = [...stage.querySelectorAll("*")]
    .filter((element) => element.scrollTop > 0 || element.scrollLeft > 0)
    .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  cover.append(...stage.childNodes);
  return { cover, scrolled };
}

/**
 * Puts a frame over `target` at `box`, where it keeps the scroll offsets that it had in its stage.
 * The box is the place of `target` when the frame shows, unless the caller measured it before.
 */
export function showFrame(
  { cover, scrolled }: Frame,
  target: HTMLElement,
  box = target.getBoundingClientRect(),
): HTMLElement {
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
  for (const { element, top, left } of scrolled) {
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  return cover;
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
