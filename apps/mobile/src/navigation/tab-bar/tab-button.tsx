import type { BottomTabBarProps } from "expo-router/js-tabs";
import { memo, type ReactElement } from "react";
import { Platform, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useNeedsYouCount } from "@/features/sessions/needs-you-count";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { needsYouBadgeText, needsYouSpokenText } from "./needs-you";

type TabMeta = { label: string; icon: IconName };

/** The label and icon of each tab. */
const tabMeta = (routeName: string): TabMeta | null => {
  switch (routeName) {
    case "(sessions)":
      return { label: "Sessions", icon: "messages-square" };
    case "(tasks)":
      return { label: "Tasks", icon: "square-kanban" };
    case "(host)":
      return { label: "Host", icon: "server" };
    case "(settings)":
      return { label: "Settings", icon: "settings" };
    default:
      return null;
  }
};

/** The size of a tab icon over its label. */
const TAB_ICON_SIZE = 25;
/**
 * The tab labels and the badge grow with the system text size up to this scale, so they stay
 * inside the fixed row of the bar at the largest text sizes.
 */
const MAX_FONT_SCALE = 1.3;
/** VoiceOver reads the position of a tab, such as "1 of 4", only inside a tab bar. */
export const TAB_ROW_ROLE = Platform.OS === "ios" ? "tabbar" : "tablist";

/** The bottom bar of portrait, or the rail on the left edge of a low window. */
export type TabPlacement = "bottom" | "rail";

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

/** The tab buttons of the navigator, in route order. */
export const tabButtons = ({
  state,
  descriptors,
  progress,
  placement,
  onPressTab,
}: Pick<BottomTabBarProps, "state" | "descriptors"> & {
  progress: SharedValue<number>;
  placement: TabPlacement;
  onPressTab: (routeKey: string) => void;
}): ReactElement[] =>
  state.routes.flatMap((route, index) => {
    const meta = tabMeta(route.name);
    if (!meta) return [];
    const tab: TabButtonProps = {
      routeKey: route.key,
      label: descriptors[route.key]?.options.title ?? meta.label,
      icon: meta.icon,
      focused: state.index === index,
      progress,
      placement,
      onPressTab,
    };
    return route.name === "(sessions)" ? (
      <SessionsTabButton key={route.key} {...tab} />
    ) : (
      <TabButton key={route.key} {...tab} />
    );
  });

type TabButtonProps = {
  label: string;
  icon: IconName;
  focused: boolean;
  progress: SharedValue<number>;
  placement: TabPlacement;
  routeKey: string;
  /** Presses the tab of `routeKey`. It stays the same, so a tab renders only on its own change. */
  onPressTab: (routeKey: string) => void;
};

const TabButton = memo(function TabButton({
  label,
  icon,
  focused,
  needsYouCount = 0,
  progress,
  placement,
  routeKey,
  onPressTab,
}: TabButtonProps & { needsYouCount?: number }): ReactElement {
  const theme = useAppTheme();
  // The tabs step back while the create menu is open, so the actions stand out.
  const dim = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [1, 0.35], Extrapolation.CLAMP),
  }));
  const color = focused ? theme.colors.label : theme.desktop.mutedForeground;
  const rail = placement === "rail";
  return (
    <Animated.View style={[rail ? styles.railTab : styles.tab, dim]}>
      {/* The open tab has a violet bar on the outer edge of the bar, in the violet of the create
          button, and its icon and label take the full text color. The bar mounts with its whole
          style: Unistyles drops the radius of a style that an array gains later. */}
      {focused ? (
        <View pointerEvents="none" style={rail ? styles.railMarker : styles.marker}>
          <View style={rail ? styles.railIndicator : styles.indicator} />
        </View>
      ) : null}
      <Touchable
        feedback="scale"
        onPress={() => onPressTab(routeKey)}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityValue={
          needsYouCount > 0 ? { text: needsYouSpokenText(needsYouCount) } : undefined
        }
        accessibilityState={{ selected: focused }}
        containerStyle={styles.tabTouch}
        style={styles.tabContent}
      >
        <View style={styles.item}>
          <View>
            <Icon name={icon} size={TAB_ICON_SIZE} colorValue={color} />
            {needsYouCount > 0 ? (
              <View style={styles.badge}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.badgeText}>
                  {needsYouBadgeText(needsYouCount)}
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            variant="caption2"
            weight={focused ? "semibold" : "medium"}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.tabLabel, { color }]}
          >
            {label}
          </Text>
        </View>
      </Touchable>
    </Animated.View>
  );
});

/**
 * The Sessions tab, with the Needs you count of every workspace on its badge and for screen
 * readers. Only this wrapper renders again on a live change; the tab renders when the count
 * changes.
 */
function SessionsTabButton(props: TabButtonProps): ReactElement {
  const count = useNeedsYouCount();
  return <TabButton {...props} needsYouCount={count} />;
}

const styles = StyleSheet.create((theme) => ({
  tab: { flex: 1, height: "100%" },
  // The tabs of the rail share its height with the create button, one slot each.
  railTab: { flex: 1, alignSelf: "stretch" },
  tabTouch: { flex: 1 },
  tabContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // The icon over the label. A tab change does not animate.
  item: {
    height: 46,
    minWidth: 60,
    maxWidth: "92%",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  marker: { position: "absolute", top: 0, right: 0, left: 0, alignItems: "center" },
  indicator: {
    width: 44,
    height: 4,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: theme.colors.tint,
  },
  railMarker: { position: "absolute", top: 0, bottom: 0, left: 0, justifyContent: "center" },
  railIndicator: {
    width: 4,
    height: 36,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: theme.colors.tint,
  },
  tabLabel: { letterSpacing: 0.1 },
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 18,
    minHeight: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.red,
    borderWidth: 2,
    // The ring cuts the badge out of the bar.
    borderColor: theme.colors.surface,
  },
  badgeText: {
    ...theme.type.caption2,
    fontSize: 10,
    lineHeight: 12,
    color: theme.colors.onTint,
  },
}));
