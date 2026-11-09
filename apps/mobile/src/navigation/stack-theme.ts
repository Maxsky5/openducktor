import type { NativeStackNavigationOptions } from "expo-router";
import { Platform } from "react-native";
import { useMemo } from "react";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";

/**
 * Native stack colors from the theme, so headers follow light and dark mode. Plain screens use
 * the content background; grouped screens use the grouped background, so the header and the
 * content read as one surface.
 */
export const useNativeStackTheme = (
  background: "plain" | "grouped" = "plain",
): NativeStackNavigationOptions => {
  const theme = useAppTheme();
  const color = background === "grouped" ? theme.colors.groupedBackground : theme.colors.background;
  return {
    // Composite screens own fixed controls above their scroll views. Keep those below the bar.
    headerTransparent: false,
    headerStyle: { backgroundColor: color },
    headerTintColor: theme.colors.label,
    headerTitleStyle: { ...sansWeight("semibold"), fontSize: 17, color: theme.colors.label },
    headerLargeStyle: { backgroundColor: color },
    headerLargeTitleStyle: { ...sansWeight("bold"), fontSize: 30, color: theme.colors.label },
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    contentStyle: { backgroundColor: color },
    headerBackButtonDisplayMode: "minimal",
    // The Android default push takes 450 ms with a long slow end. This one takes 200 ms and moves
    // the screen under it aside, as the swipe back does. iOS keeps its own push.
    animation: Platform.OS === "android" ? "ios_from_right" : "default",
  };
};

/** A root screen of a tab: a large title on iOS that collapses on scroll. */
export const rootScreenOptions: NativeStackNavigationOptions = {
  headerLargeTitleEnabled: Platform.OS === "ios",
  headerTransparent: Platform.OS === "ios",
};

/**
 * A stable iOS header search button keeps enlarged text clear of fixed workspace controls.
 * Toolbar integration stays off so the custom bottom navigation cannot cover search.
 */
export const useHeaderSearchOptions = () => {
  const theme = useAppTheme();
  const { label, tertiaryLabel, tint, surface } = theme.colors;
  return useMemo<NonNullable<NativeStackNavigationOptions["headerSearchBarOptions"]>>(
    () => ({
      placement: Platform.OS === "ios" ? "integratedButton" : "stacked",
      allowToolbarIntegration: false,
      headerIconColor: label,
      textColor: label,
      hintTextColor: tertiaryLabel,
      tintColor: tint,
      barTintColor: surface,
    }),
    [label, surface, tertiaryLabel, tint],
  );
};
