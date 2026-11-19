// The icon swap of a tool call that ends in a mobile transcript, as ToolCallIcon of
// tool-status.tsx in apps/mobile/src/features/session/transcript/rows moves it: the moving bars go
// at once, and the icon of the tool fades in and grows from 60 percent in 220 ms. tool-runs.ts and
// pending-question.ts swap the icons of their calls with it.
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { APP_EASE_OUT } from "./app-motion";

/** SWAP_IN of tool-status.tsx: the new icon fades in and grows from 60 percent in 220 ms. */
export const ICON_SWAP_IN = { scale: 0.6, duration: 0.22 };

/**
 * Seconds from the start of the swap to the first frame that shows it. The app commits a change
 * between two frames of the screen, so its first frame shows a swap that started half a frame
 * before, on average. A swap that starts on a frame of the scene would show no icon in that frame.
 */
const FIRST_FRAME = 1 / 120;

/**
 * Grows in the glyph `glyph` of a call that ends at `at`. The glyph is hidden while the call runs,
 * so the swap starts half a frame before the end and shows from `at`.
 */
export function swapIcon(scene: Scene, glyph: Element, at: number): void {
  scene.timeline.add(
    gsap.fromTo(
      glyph,
      { autoAlpha: 0, scale: ICON_SWAP_IN.scale },
      {
        autoAlpha: 1,
        scale: 1,
        duration: ICON_SWAP_IN.duration,
        ease: APP_EASE_OUT,
        immediateRender: false,
        clearProps: "opacity,visibility,transform",
      },
    ),
    at - FIRST_FRAME,
  );
}
