import type { BottomTabBarProps } from "expo-router/js-tabs";
import { type ReactElement, useCallback, useLayoutEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { CreateButton } from "./create-button";
import { CreateFan } from "./create-fan";
import {
  RAIL_CREATE_HIT_SLOP,
  RAIL_WIDTH,
  railCreateCenter,
  railSurfaceTransform,
  TAB_BAR,
  tabBarEdgePath,
  tabBarPath,
} from "./tab-bar-geometry";
import { pressTabRoute, TAB_ROW_ROLE, tabButtons } from "./tab-button";
import { useCreateFan } from "./use-create-fan";

/** The create button goes after this many tabs. */
const CREATE_SLOT = 2;
/** The room beside the right edge of the rail for its hairline. */
const EDGE_ROOM = 1;

/**
 * The tabs on the left edge of a low window, such as a phone in landscape: the surface of the
 * bottom bar turned to the left edge. Sessions and Tasks sit above the create button, Host and
 * Settings under it, and the five slots share the height. The create button sits in a cradle in
 * the middle of the right edge and opens New Task, New Chat, and Import on an arc to its right.
 * The rail takes the left safe area.
 */
export function NavigationRail({
  state,
  descriptors,
  emitter,
  navigateToTab,
}: BottomTabBarProps): ReactElement {
  const theme = useAppTheme();
  const { left } = useSafeAreaInsets();
  const width = left + RAIL_WIDTH;
  const [height, setHeight] = useState(0);
  const { progress, open, menuMounted, close, toggle } = useCreateFan();
  // A tab press reads the latest state, so each tab keeps one press handler and a tab change
  // renders only the two tabs whose focus changed.
  const latest = useRef({ open, close, state, emitter, navigateToTab });
  useLayoutEffect(() => {
    latest.current = { open, close, state, emitter, navigateToTab };
  });
  const pressTab = useCallback((routeKey: string): void => {
    const { open, close } = latest.current;
    if (open) close();
    pressTabRoute(routeKey, latest.current);
  }, []);
  const tabs = tabButtons({
    state,
    descriptors,
    progress,
    placement: "rail",
    onPressTab: pressTab,
  });
  const measure = useCallback((event: LayoutChangeEvent) => {
    setHeight(event.nativeEvent.layout.height);
  }, []);

  return (
    <>
      {/* The tab bar mounts before the screens, so each layer of the rail sets its order: the
          screens, then the fan with its scrim, then the rail, as the bar does, then the button. */}
      {menuMounted ? (
        <View pointerEvents="box-none" style={styles.fanLayer}>
          <CreateFan placement="rail" progress={progress} onClose={close} />
        </View>
      ) : null}
      <View style={[styles.rail, { width }]} onLayout={measure}>
        {/* The view box reaches one point past the rail, so the hairline of the edge shows in
            full. */}
        {height > 0 ? (
          <Svg
            pointerEvents="none"
            width={width + EDGE_ROOM}
            height={height}
            viewBox={`0 0 ${width + EDGE_ROOM} ${height}`}
            style={styles.surface}
          >
            <Path
              d={tabBarPath(height, width)}
              transform={railSurfaceTransform(width)}
              fill={theme.colors.surface}
            />
            <Path
              d={tabBarEdgePath(height)}
              transform={railSurfaceTransform(width)}
              fill="none"
              stroke={theme.colors.border}
              strokeWidth={theme.hairline}
            />
          </Svg>
        ) : null}
        <View accessibilityRole={TAB_ROW_ROLE} style={styles.tabs}>
          {tabs.slice(0, CREATE_SLOT)}
          <View style={styles.createSlot} />
          {tabs.slice(CREATE_SLOT)}
        </View>
      </View>
      {/* The anchor reaches the left edge of the rail, so the touch slop of the button stays inside
          its parent. */}
      <View
        pointerEvents="box-none"
        style={[styles.createAnchor, { width: railCreateCenter(left) + TAB_BAR.createSize / 2 }]}
      >
        <CreateButton
          open={open}
          progress={progress}
          hitSlop={RAIL_CREATE_HIT_SLOP}
          onPress={toggle}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create((_theme, runtime) => ({
  fanLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 },
  rail: { alignSelf: "stretch", zIndex: 2 },
  surface: { position: "absolute", top: 0, left: 0 },
  // The same space above and under the tabs keeps the create button in the middle of the screen,
  // on the cradle.
  tabs: {
    flex: 1,
    paddingLeft: runtime.insets.left,
    paddingTop: Math.max(runtime.insets.top, runtime.insets.bottom),
    paddingBottom: Math.max(runtime.insets.top, runtime.insets.bottom),
  },
  createSlot: { flex: 1 },
  createAnchor: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 3,
    alignItems: "flex-end",
    justifyContent: "center",
  },
}));
