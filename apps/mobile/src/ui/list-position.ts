/**
 * Keeps a list at its top when rows above the first visible row change height. FlashList keeps
 * the visible row in place by default, so a list with a header would open scrolled down.
 */
export const KEEP_TOP_VISIBLE = { autoscrollToTopThreshold: 64 };
