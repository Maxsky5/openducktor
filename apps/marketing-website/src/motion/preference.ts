// The motion preference of the visitor: the reduced motion setting of the system, and the pause
// control of the header. This module has no GSAP, so a page without views does not load it.

/** The media query of visitors who accept motion. Every player and the page head use it. */
export const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";

const listeners = new Set<() => void>();
let paused = false;

/** True while the visitor keeps motion paused with the header control. */
export function isPausedByVisitor(): boolean {
  return paused;
}

/** Calls `listener` after each change of the pause control. Returns the unsubscribe function. */
export function onPauseChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Binds the header control that pauses every view (WCAG 2.2.2). The control shows only while the
 * visitor accepts motion. It sets data-motion on the page root, which also pauses the CSS
 * animations of the page.
 */
export function bindMotionControl(button: HTMLButtonElement): void {
  const motion = window.matchMedia(MOTION_QUERY);
  const render = (): void => {
    const label = paused ? "Play animations" : "Pause animations";
    button.setAttribute("aria-pressed", String(paused));
    button.setAttribute("aria-label", label);
    button.title = label;
    document.documentElement.dataset.motion = paused ? "paused" : "running";
  };
  const follow = (): void => {
    button.hidden = !motion.matches;
    if (motion.matches) render();
    else delete document.documentElement.dataset.motion;
  };
  button.addEventListener("click", () => {
    paused = !paused;
    render();
    for (const listener of listeners) listener();
  });
  motion.addEventListener("change", follow);
  follow();
}
