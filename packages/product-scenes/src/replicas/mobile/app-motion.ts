// The easing curves of the mobile app, for the steps of the phone replicas. The app gives its
// curves as cubic Bézier curves: `motion.easeOut` of apps/mobile/src/theme/tokens.ts, and the
// glide of a tool run that folds in transcript-chat-list.tsx of
// apps/mobile/src/features/session/transcript.
import type { AppCurve } from "../../motion/gsap";

/** `motion.easeOut`, cubic-bezier(0.23, 1, 0.32, 1): a fast start and a long, soft end. */
export const APP_EASE_OUT: AppCurve = "mobile-ease-out";

/** GLIDE of transcript-chat-list.tsx, cubic-bezier(0.4, 0, 0.2, 1): it starts and ends gently. */
export const FOLD_GLIDE: AppCurve = "mobile-fold-glide";
