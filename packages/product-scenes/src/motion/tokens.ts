// The motion vocabulary of the views, so each tween names its intent and not a curve.
import type { AppCurve } from "./gsap";

/**
 * --motion-ease-out of motion.css in packages/frontend/src/components/ui,
 * cubic-bezier(0.22, 1, 0.36, 1): the curve of the chat and the dialogs of the desktop app.
 */
const DESKTOP_EASE_OUT: AppCurve = "desktop-ease-out";

/** cubic-bezier(0.23, 1, 0.32, 1): the glides and the entries of a new session of the desktop app. */
const DESKTOP_GLIDE: AppCurve = "desktop-glide";

export const EASE = {
  /** An element comes in or grows, and slows down at the end. */
  enter: "power2.out",
  /** An element goes away or shrinks, and speeds up at the end. */
  exit: "power2.in",
  /** An element changes size or place, and eases at both ends. */
  move: "power2.inOut",
  /** A long move across the view, such as the pointer or a flying card. */
  travel: "power3.inOut",
  /** A dialog or a notification comes in. */
  arrive: "power3.out",
  /** A dialog closes, and its overlay fades out. */
  dismiss: "power1.in",
  /**
   * The composer of a new session glides to its dock, and the startup card and the sent message
   * come in: the curve of useComposerDockGlide and inline-session-startup.css.
   */
  glide: DESKTOP_GLIDE,
  /** A row, a tool call, or a fold of the chat of the app, on --motion-ease-out. */
  chat: DESKTOP_EASE_OUT,
  /**
   * A dialog takes the size of its new content: --resize-ease of dialog.css, which is
   * --motion-ease-out. The fast start takes most of the old size away in the first frames.
   */
  resize: DESKTOP_EASE_OUT,
  /** A gentle start and a slow end, for a fade or a short pulse. */
  gentle: "power1.out",
  /** A cross fade between two frames. */
  fade: "power1.inOut",
  /** A new card lands with a small overshoot. */
  land: "back.out(1.6)",
  /** A badge snaps into place. */
  snap: "back.out(2.2)",
  /** A status badge takes its new width with a larger overshoot. */
  pop: "back.out(2.5)",
  /** A slow back and forth, such as a duck that floats on the water. */
  float: "sine.inOut",
  /** A steady rate, such as typed text or water that flows. */
  steady: "none",
  /** Values that arrive in batches, such as the token use of each response. */
  batches: "steps(14)",
} as const;
