import type { NativeIntent } from "expo-router";

/**
 * The app has no external deep links, so another app or a web page cannot open an internal route
 * with an `openducktor://` URL. A launch URL opens the start screen. A URL that arrives while the
 * app runs changes nothing.
 */
export const redirectSystemPath: NonNullable<NativeIntent["redirectSystemPath"]> = ({ initial }) =>
  initial ? "/" : null;
