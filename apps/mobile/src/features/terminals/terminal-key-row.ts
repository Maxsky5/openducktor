/** The horizontal scroll state of the terminal key row, in points. */
export type KeyRowScroll = {
  /** The scroll offset from the start of the row. */
  offset: number;
  /** The visible width of the row. */
  viewport: number;
  /** The width of all keys. */
  content: number;
};

/** True while keys lie past the right edge of the row. A gap of one point or less is rounding. */
export const keysPastRightEdge = ({ offset, viewport, content }: KeyRowScroll): boolean =>
  viewport > 0 && content - offset - viewport > 1;
