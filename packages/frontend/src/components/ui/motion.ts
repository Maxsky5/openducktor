/** The control points of `--motion-ease-out` in `motion.css`, for motion that JavaScript starts. */
export const MOTION_EASE_OUT_POINTS = [0.22, 1, 0.36, 1] as const;

/** The same curve as a CSS easing. The Web Animations API cannot read a CSS variable. */
export const MOTION_EASE_OUT = `cubic-bezier(${MOTION_EASE_OUT_POINTS.join(", ")})`;
