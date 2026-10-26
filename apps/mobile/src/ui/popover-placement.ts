/** The space between the card and the screen edges. */
export const POPOVER_EDGE = 12;
/** The space between the card and its trigger. */
export const POPOVER_GAP = 6;

export type PopoverAnchor = { x: number; y: number; width: number; height: number };

/**
 * The slot of the card on the screen. Below its trigger, the card starts at the slot top. Above
 * it, the slot ends at the trigger and the card sits on the slot bottom, so the gap to the
 * trigger stays the same whatever the real card height is.
 */
export type PopoverPlacement = {
  top: number;
  left: number;
  /** The slot height above the trigger, or null below it. */
  height: number | null;
  /** The tallest card that fits on its side of the trigger. A taller card scrolls its content. */
  maxHeight: number;
  /** The corner of the card nearest to its trigger, where the open animation starts. */
  origin: string;
};

/**
 * Places the card below its trigger, or above it when the estimated height fits only above. A
 * card that fits on neither side goes to the side with more space.
 * The card aligns with the trigger edge nearer to the screen edge, so it grows into the screen.
 */
export const placePopover = (
  anchor: PopoverAnchor,
  size: { width: number; height: number },
  screen: { width: number; height: number },
  insets: { top: number; bottom: number },
): PopoverPlacement => {
  const alignRight = anchor.x + anchor.width / 2 > screen.width / 2;
  const rawLeft = alignRight ? anchor.x + anchor.width - size.width : anchor.x;
  const left = Math.min(Math.max(POPOVER_EDGE, rawLeft), screen.width - size.width - POPOVER_EDGE);
  const horizontal = alignRight ? "right" : "left";
  const below = anchor.y + anchor.height + POPOVER_GAP;
  const spaceBelow = Math.max(0, screen.height - insets.bottom - POPOVER_EDGE - below);
  const top = insets.top + POPOVER_EDGE;
  const spaceAbove = Math.max(0, anchor.y - POPOVER_GAP - top);
  if (size.height <= spaceBelow || spaceBelow >= spaceAbove) {
    return { top: below, left, height: null, maxHeight: spaceBelow, origin: `top ${horizontal}` };
  }
  return { top, left, height: spaceAbove, maxHeight: spaceAbove, origin: `bottom ${horizontal}` };
};
