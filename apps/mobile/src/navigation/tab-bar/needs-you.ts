/** The text of the Needs you badge on the Sessions tab. */
export const needsYouBadgeText = (count: number): string => (count > 99 ? "99+" : String(count));

/** What a screen reader says after the label of the Sessions tab. */
export const needsYouSpokenText = (count: number): string =>
  count === 1 ? "1 session needs you" : `${count} sessions need you`;
