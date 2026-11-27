// The motion of a popover surface of the app, from popover.css: it grows from 97 % and fades in
// over 250 ms, and it shrinks to 99 % and fades out over 150 ms, both on --motion-ease-out. A step
// adds the tween with `scene.run`.
import { gsap } from "../../motion/gsap";
import { EASE } from "../../motion/tokens";

/** --popover-open-dur and --popover-scale of popover.css. */
const OPEN = { duration: 0.25, scale: 0.97 };
/** --popover-close-dur and --popover-scale-close of popover.css. */
const CLOSE = { duration: 0.15, scale: 0.99 };

/** Shows a hidden popover surface: it grows from its origin and fades in. */
export function popoverIn(element: HTMLElement): gsap.core.Tween {
  element.hidden = false;
  return gsap.fromTo(
    element,
    { autoAlpha: 0, scale: OPEN.scale },
    {
      autoAlpha: 1,
      scale: 1,
      duration: OPEN.duration,
      ease: EASE.chat,
      clearProps: "opacity,visibility,transform",
    },
  );
}

/** Closes a popover surface, then hides it. */
export function popoverOut(element: HTMLElement): gsap.core.Tween {
  return gsap.to(element, {
    autoAlpha: 0,
    scale: CLOSE.scale,
    duration: CLOSE.duration,
    ease: EASE.chat,
    onComplete: () => {
      element.hidden = true;
      gsap.set(element, { clearProps: "opacity,visibility,transform" });
    },
  });
}
