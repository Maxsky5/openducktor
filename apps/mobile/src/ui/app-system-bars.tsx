import { requireNativeView } from "expo";
import type { ReactElement } from "react";
import { Platform, StatusBar, type ViewProps } from "react-native";
import { SystemBars } from "react-native-edge-to-edge";
import { StyleSheet } from "react-native-unistyles";

const ModalStatusBar =
  Platform.OS === "android"
    ? requireNativeView<ViewProps & { darkIcons: boolean }>("OpenDucktorKeyboard", "ModalStatusBar")
    : null;

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
 * The keyboard controller's Android `StatusBar` module and `SystemBars` style the activity window.
 * Each Android modal uses `ModalSystemBars` to style its own dialog window.
 */
export function AppSystemBars({ icons }: { icons: "light" | "dark" }): ReactElement {
  return (
    <>
      <StatusBar barStyle={icons === "light" ? "light-content" : "dark-content"} animated />
      <SystemBars style={NAVIGATION_BARS[icons]} hidden={HIDDEN_BARS} />
    </>
  );
}

/** Keeps an Android dialog's status bar in sync without changing the activity or other dialogs. */
export function ModalSystemBars({ icons }: { icons: "light" | "dark" }): ReactElement | null {
  if (!ModalStatusBar) return null;
  return (
    <ModalStatusBar
      darkIcons={icons === "dark"}
      pointerEvents="none"
      accessible={false}
      style={styles.controller}
    />
  );
}

const styles = StyleSheet.create({
  controller: { position: "absolute", width: 0, height: 0 },
});
