import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Platform } from "react-native";

/** VoiceOver reads the position of a tab, such as "1 of 4", only inside a tab bar. */
export const TAB_ROW_ROLE = Platform.OS === "ios" ? "tabbar" : "tablist";

type TabNavigation = Pick<BottomTabBarProps, "state" | "emitter" | "navigateToTab">;

/** Presses the tab of `routeKey`, as the default tab bar does. */
export const pressTabRoute = (
  routeKey: string,
  { state, emitter, navigateToTab }: TabNavigation,
): void => {
  const focused = state.routes[state.index]?.key === routeKey;
  const event = emitter.emit({ type: "tabPress", target: routeKey, canPreventDefault: true });
  if (!focused && !event.defaultPrevented) navigateToTab(routeKey);
};
