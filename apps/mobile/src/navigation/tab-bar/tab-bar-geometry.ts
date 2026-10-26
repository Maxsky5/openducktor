/**
 * The tab bar: a full-width surface on the bottom edge, under the Android navigation buttons too.
 * Its top edge dips into a cradle around the create button, which sits low in the bar.
 */
export const TAB_BAR = {
  /** The row of tabs, above the bottom safe area. */
  height: 64,
  /** A tablet keeps the tabs at phone width, centered on the cradle. */
  maxRowWidth: 560,
  createSize: 56,
  /**
   * How far the center of the create button sits above the top edge of the bar. A negative lift
   * sits the button in the bar, so less of it rises over the screen.
   */
  createLift: -12,
  /** The space between the create button and the cradle. */
  cradleGap: 5,
  /** The radius of the rounded shoulders where the cradle meets the top edge. */
  shoulderRadius: 16,
} as const;

/** How far the create button rises above the top edge of the bar. */
export const CREATE_RISE = TAB_BAR.createSize / 2 + TAB_BAR.createLift;

const cradleRadius = TAB_BAR.createSize / 2 + TAB_BAR.cradleGap;
// The center of the create button, from the top edge of the bar. Negative is above the edge.
const createCenterY = -TAB_BAR.createLift;
// Each shoulder is a circle under the top edge that touches the cradle circle from outside.
const shoulderReach = Math.sqrt(
  (cradleRadius + TAB_BAR.shoulderRadius) ** 2 - (TAB_BAR.shoulderRadius - createCenterY) ** 2,
);

/** The half width of the cradle, at the top edge of the bar. The tabs stay outside it. */
export const CRADLE_HALF_WIDTH = shoulderReach;

/**
 * The touch slop of the create button. The button takes the touches of its whole slot in the row:
 * the cradle beside it and the bar under it, down to the bottom of the row.
 */
export const CREATE_HIT_SLOP = {
  top: 0,
  left: CRADLE_HALF_WIDTH - TAB_BAR.createSize / 2,
  right: CRADLE_HALF_WIDTH - TAB_BAR.createSize / 2,
  bottom: CREATE_RISE + TAB_BAR.height - TAB_BAR.createSize,
} as const;

/** How far the bottom of the cradle sits below the top edge of the bar. */
export const CRADLE_DEPTH = createCenterY + cradleRadius;

/** The top edge of the bar, with the cradle in its middle. */
export const tabBarEdgePath = (width: number): string => {
  const center = width / 2;
  // The shoulder meets the cradle on the line between the centers of the two circles.
  const reach = cradleRadius / (cradleRadius + TAB_BAR.shoulderRadius);
  const meetX = shoulderReach * reach;
  const meetY = createCenterY + (TAB_BAR.shoulderRadius - createCenterY) * reach;
  const shoulder = `${TAB_BAR.shoulderRadius} ${TAB_BAR.shoulderRadius} 0 0 1`;
  return [
    "M 0 0",
    `L ${center - shoulderReach} 0`,
    `A ${shoulder} ${center - meetX} ${meetY}`,
    `A ${cradleRadius} ${cradleRadius} 0 0 0 ${center + meetX} ${meetY}`,
    `A ${shoulder} ${center + shoulderReach} 0`,
    `L ${width} 0`,
  ].join(" ");
};

/** The outline of the bar: the top edge with its cradle, then down to the bottom edge. */
export const tabBarPath = (width: number, height: number): string =>
  `${tabBarEdgePath(width)} L ${width} ${height} L 0 ${height} Z`;

/** The distance from the bottom edge to the center of the create button. */
export const createButtonCenter = (bottomInset: number): number =>
  bottomInset + TAB_BAR.height + TAB_BAR.createLift;

/**
 * The rail of a low window, such as a phone in landscape: the surface of the bar turned to the
 * left edge, with the cradle in the middle of its right edge.
 */
export const RAIL_WIDTH = 80;

/** The distance from the left edge of the screen to the center of the create button of the rail. */
export const railCreateCenter = (leftInset: number): number =>
  leftInset + RAIL_WIDTH + TAB_BAR.createLift;

/**
 * The touch slop of the create button of the rail: the cradle above and under it, and the rail
 * to its left.
 */
export const RAIL_CREATE_HIT_SLOP = {
  top: CRADLE_HALF_WIDTH - TAB_BAR.createSize / 2,
  bottom: CRADLE_HALF_WIDTH - TAB_BAR.createSize / 2,
  left: RAIL_WIDTH + TAB_BAR.createLift - TAB_BAR.createSize / 2,
  right: 0,
} as const;

/**
 * The SVG transform that turns the bar outline into the rail outline: the top edge of the bar
 * becomes the right edge of the rail, at `railWidth`.
 */
export const railSurfaceTransform = (railWidth: number): string =>
  `translate(${railWidth} 0) rotate(90)`;
