import type { CSSProperties } from "react";

// The geometry of the tour pictures: the ratio of the frames and the inset of the picture area.

/** The width to height ratio of the picture frames, which the live scenes fill. */
export const TOUR_FRAME_ASPECT = 2954 / 1396;

/** The space between a picture and the edges of the picture area. */
const TOUR_INSET = "3.5rem";

/** An inline style that sets CSS custom properties. */
export type CssVariableStyle = CSSProperties & Record<`--${string}`, string>;

/**
 * The geometry of the picture area as CSS variables, for the dialog that holds it: the frame ratio
 * in `--t-tour-frame-aspect`, and the inset in `--t-tour-inset`.
 */
export const TOUR_GEOMETRY_STYLE: CssVariableStyle = {
  "--t-tour-frame-aspect": String(TOUR_FRAME_ASPECT),
  "--t-tour-inset": TOUR_INSET,
};
