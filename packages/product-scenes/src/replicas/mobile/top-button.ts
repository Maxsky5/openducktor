// The button that scrolls a mobile transcript to its first message, as TranscriptTopButton of
// transcript-controls.tsx and the follow rules of transcript-follow.ts in
// apps/mobile/src/features/session/transcript. The transcript stays at its latest message, so the
// button shows while the rows above the screen are more than a fifth of the screen high. A size
// change of the transcript or of its rows shows or hides the button with a short slide and fade.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { APP_EASE_OUT } from "./app-motion";

/** TOP_THRESHOLD_FRACTION: the share of the screen height that still counts as the top. */
const TOP_SHARE = 0.2;

/** The space above the first message and under the latest message, in points. */
const EDGE = 16;

/** appearStyle: the button slides 12 points and fades in `motion.base`, 240 ms. */
const APPEAR = { offset: -12, duration: 0.24 };

/**
 * Shows the top button of the session screen `screen` while the reader is away from the first
 * message. The button starts hidden, as the app starts at the top until it measures the list.
 */
export function topButton(scene: Scene, screen: HTMLElement): void {
  const transcript = must(screen, "[data-transcript]");
  const track = must(screen, "[data-track]");
  const button = must(screen, "[data-top-button]");
  button.removeAttribute("data-shown");
  const observer = new ResizeObserver(() => {
    if (!screen.isConnected) {
      observer.disconnect();
      return;
    }
    const viewport = transcript.clientHeight;
    if (viewport === 0) return;
    const away =
      track.offsetHeight + 2 * EDGE * designPixel(screen) - viewport >
      Math.max(1, viewport * TOP_SHARE);
    if (away === button.hasAttribute("data-shown")) return;
    button.toggleAttribute("data-shown", away);
    const hidden = { opacity: 0, y: APPEAR.offset * designPixel(screen) };
    const shown = { opacity: 1, y: 0 };
    const duration = Math.min(APPEAR.duration, scene.timeLeft());
    if (duration === 0) return;
    scene.runNow(
      gsap.fromTo(button, away ? hidden : shown, {
        ...(away ? shown : hidden),
        duration,
        ease: APP_EASE_OUT,
        clearProps: "opacity,transform",
        overwrite: true,
      }),
    );
  });
  observer.observe(transcript);
  observer.observe(track);
}
