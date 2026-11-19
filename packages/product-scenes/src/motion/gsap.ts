// The one place that loads GSAP for the scenes and the site animations. The exact cubic Bézier
// curves of the apps are CustomEase eases that the tweens name. `registerAppEases` registers them
// before a scene builds, so loading this module starts no GSAP work: a page that renders on the
// server or a test without a browser can import it.
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

/** The cubic Bézier curves of the apps, by the ease name that the tweens use. */
const APP_CURVES = {
  /** --motion-ease-out of motion.css in packages/frontend/src/components/ui. */
  "desktop-ease-out": "0.22,1,0.36,1",
  /** `motion.easeOut` of apps/mobile/src/theme/tokens.ts. */
  "mobile-ease-out": "0.23,1,0.32,1",
  /** GLIDE of transcript-chat-list.tsx in apps/mobile/src/features/session/transcript. */
  "mobile-fold-glide": "0.4,0,0.2,1",
} as const;

/** The name of a curve of the apps, which a tween gives as its ease. */
export type AppCurve = keyof typeof APP_CURVES;

let registered = false;

/** Registers CustomEase and the curves of the apps, once, before the first scene builds. */
export function registerAppEases(): void {
  if (registered) return;
  gsap.registerPlugin(CustomEase);
  for (const [name, curve] of Object.entries(APP_CURVES)) CustomEase.create(name, curve);
  registered = true;
}

export { gsap };
