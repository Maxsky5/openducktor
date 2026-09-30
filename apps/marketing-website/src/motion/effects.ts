// Tweens that the scenes add at the time of a change, with `scene.run`. Each one measures the
// page when it starts, so it follows the layout of the frame at that time.
import { gsap } from "./gsap";
import { EASE } from "./tokens";

/** The box properties that a growing element animates from zero, and clears at the end. */
const GROWN = "height,paddingTop,paddingBottom,marginTop,marginBottom,opacity,visibility";

/** The state of an element while its height changes. The replica CSS clips its content. */
const RESIZING = "data-resizing";

/** One design pixel of a replica, in CSS pixels. It changes with the width of the stage. */
export function designPixel(element: Element): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue("--u"));
  if (!Number.isFinite(value)) throw new Error("The replica has no --u design pixel.");
  return value;
}

/** The brand violet of the page tokens with `alpha`, for a glow that a tween fades out. */
export function brandColor(element: Element, alpha: number): string {
  const value = getComputedStyle(element).getPropertyValue("--brand").trim();
  if (!value) throw new Error("The page has no --brand color.");
  const [red, green, blue] = gsap.utils.splitColor(value);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** A short scale pulse that draws the eye to a change. */
export function pop(element: Element, scale = 1.2): gsap.core.Tween {
  return gsap.fromTo(
    element,
    { scale: 1 },
    { scale, duration: 0.15, yoyo: true, repeat: 1, ease: EASE.gentle },
  );
}

export function fadeIn(element: Element, duration = 0.3): gsap.core.Tween {
  return gsap.fromTo(
    element,
    { autoAlpha: 0 },
    { autoAlpha: 1, duration, ease: EASE.gentle, clearProps: "opacity,visibility" },
  );
}

/** Fades elements in while they rise by `rise` CSS pixels, `stagger` seconds apart. */
export function riseIn(
  targets: gsap.TweenTarget,
  rise: number,
  duration = 0.35,
  stagger = 0,
): gsap.core.Tween {
  return gsap.fromTo(
    targets,
    { autoAlpha: 0, y: rise },
    {
      autoAlpha: 1,
      y: 0,
      duration,
      stagger,
      ease: EASE.enter,
      clearProps: "opacity,visibility,transform",
    },
  );
}

/** Grows an element from zero height, so the elements after it move instead of jumping. */
export function growIn(element: HTMLElement, duration = 0.4): gsap.core.Tween {
  const style = getComputedStyle(element);
  const grown = {
    height: element.offsetHeight,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
  };
  element.toggleAttribute(RESIZING, true);
  return gsap.fromTo(
    element,
    { height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0, autoAlpha: 0 },
    {
      ...grown,
      autoAlpha: 1,
      duration,
      ease: EASE.enter,
      clearProps: GROWN,
      onComplete: () => element.removeAttribute(RESIZING),
    },
  );
}

/** Shrinks an element to zero height, then removes it. */
export function shrinkOut(element: HTMLElement, duration = 0.35): gsap.core.Tween {
  element.toggleAttribute(RESIZING, true);
  return gsap.to(element, {
    height: 0,
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 0,
    marginBottom: 0,
    autoAlpha: 0,
    duration,
    ease: EASE.exit,
    onComplete: () => element.remove(),
  });
}

/** Animates the height change of `element` between two heights. */
function heightChange(element: HTMLElement, from: number, to: number): gsap.core.Tween {
  element.toggleAttribute(RESIZING, true);
  return gsap.fromTo(
    element,
    { height: from },
    {
      height: to,
      duration: 0.3,
      ease: EASE.move,
      clearProps: "height",
      onComplete: () => element.removeAttribute(RESIZING),
    },
  );
}

/** Animates the height change that `change` causes. Returns undefined when the height stays. */
export function morphHeight(element: HTMLElement, change: () => void): gsap.core.Tween | undefined {
  const from = element.offsetHeight;
  change();
  const to = element.offsetHeight;
  return from === to ? undefined : heightChange(element, from, to);
}

/** Replaces `current` with `next`, and animates the height change. */
export function replaceGrow(current: HTMLElement, next: HTMLElement): gsap.core.Tween {
  const from = current.offsetHeight;
  current.replaceWith(next);
  return heightChange(next, from, next.offsetHeight);
}

/** The new children of an element come in from a smaller size. */
export function settleIn(children: HTMLCollection | Element[]): gsap.core.Tween {
  return gsap.fromTo(
    children,
    { autoAlpha: 0.3, scale: 0.96 },
    {
      autoAlpha: 1,
      scale: 1,
      duration: 0.3,
      ease: EASE.enter,
      clearProps: "transform,opacity,visibility",
    },
  );
}
