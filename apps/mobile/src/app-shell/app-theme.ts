import { Appearance } from "react-native";
import { UnistylesRuntime } from "react-native-unistyles";
import type { ThemePreference } from "@/device-data/device-records";
import type { DevicePreferences } from "@/preferences/device-preferences";

/**
 * Applies the theme to the app styles and to the native views, such as the keyboard, menus, and
 * system sheets. `system` follows the device again.
 */
const applyTheme = (theme: ThemePreference) => {
  Appearance.setColorScheme(theme === "system" ? "unspecified" : theme);
  if (theme === "system") {
    UnistylesRuntime.setAdaptiveThemes(true);
    return;
  }
  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(theme);
};

/**
 * Applies the stored theme before the first render, so the first frame and the splash fade use
 * it. Each later change of the preference applies at once.
 */
export const followThemePreference = (preferences: DevicePreferences): void => {
  applyTheme(preferences.state.getState().preferences.theme);
  preferences.state.subscribe((state, previous) => {
    if (state.preferences.theme !== previous.preferences.theme) applyTheme(state.preferences.theme);
  });
};
