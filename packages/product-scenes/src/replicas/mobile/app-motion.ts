// The easing curves of the mobile app as GSAP eases, for the steps of the phone replicas. The app
// gives its curves as CSS cubic Bézier curves: `motion.easeOut` of
// apps/mobile/src/theme/tokens.ts, and the glide of a tool run that opens or folds in
// transcript-chat-list.tsx of apps/mobile/src/features/session/transcript.

/**
 * The GSAP ease of the CSS curve `cubic-bezier(x1, y1, x2, y2)`. It finds the curve parameter of
 * a progress with Newton steps, and halves the range when a step stalls.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (progress: number) => number {
  // The polynomial coefficients of each coordinate of the curve.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const curveX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const curveY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  const parameterOf = (x: number): number => {
    let t = x;
    for (let step = 0; step < 8; step += 1) {
      const error = curveX(t) - x;
      if (Math.abs(error) < 1e-6) return t;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    while (high - low > 1e-6) {
      if (curveX(t) < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return t;
  };
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return curveY(parameterOf(progress));
  };
}

/** `motion.easeOut` of the app: a fast start and a long, soft end. */
export const APP_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** The glide of the rows when a tool run opens or folds: it starts and ends gently. */
export const FOLD_GLIDE = cubicBezier(0.4, 0, 0.2, 1);
