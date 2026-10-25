import type { ReactElement } from "react";
import { StatusBar } from "react-native";
import { SystemBars } from "react-native-edge-to-edge";

/** `SystemBars` entries that set only the navigation buttons. */
const NAVIGATION_BARS = {
  light: { navigationBar: "light" },
  dark: { navigationBar: "dark" },
} as const;

/**
 * The Android navigation buttons stay hidden, so the tab bar and the screens take their space. A
 * swipe from the bottom edge shows them for a moment, over the screen.
 */
const HIDDEN_BARS = { navigationBar: true } as const;

/**
 * The system bar `icons`: `light` over a dark screen, `dark` over a light screen. The last mounted
 * entry wins, as with `SystemBars`.
 *
 * React Native `StatusBar` sets the status bar, because it also styles the window of each open
 * `Modal`. On Android, a modal is a dialog window that copies the status bar only when it opens,
 * and `SystemBars` styles only the activity window. A theme change during an open sheet then kept
 * the old status bar. `SystemBars` sets the Android navigation buttons, which `StatusBar` cannot.
 */
export function AppSystemBars({ icons }: { icons: "light" | "dark" }): ReactElement {
  return (
    <>
      <StatusBar barStyle={icons === "light" ? "light-content" : "dark-content"} animated />
      <SystemBars style={NAVIGATION_BARS[icons]} hidden={HIDDEN_BARS} />
    </>
  );
}
