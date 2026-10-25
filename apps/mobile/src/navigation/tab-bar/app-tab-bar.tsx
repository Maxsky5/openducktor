import type { BottomTabBarProps } from "expo-router/js-tabs";
import { type ReactElement, useCallback, useLayoutEffect, useRef } from "react";
import { useWindowDimensions, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { useCompactHeight } from "@/ui/use-wide-layout";
import { CreateButton } from "./create-button";
import { CreateFan } from "./create-fan";
import { NavigationRail } from "./navigation-rail";
import {
  CRADLE_DEPTH,
  CRADLE_HALF_WIDTH,
  CREATE_HIT_SLOP,
  CREATE_RISE,
  TAB_BAR,
  tabBarEdgePath,
  tabBarPath,
} from "./tab-bar-geometry";
import { pressTabRoute, TAB_ROW_ROLE, tabButtons } from "./tab-button";
import { useCreateFan } from "./use-create-fan";

/** The create button goes after this many tabs. */
const CREATE_SLOT = 2;

/** The room above the top edge of the bar for its hairline. */
const EDGE_ROOM = 1;
/**
 * The tabs: a bar on the bottom edge, or a rail on the left edge of a low window, such as a phone
 * in landscape, so the screens keep their height. The tabs layout sets the matching
 * `tabBarPosition`.
 */
export function AppTabBar(props: BottomTabBarProps): ReactElement {
  return useCompactHeight() ? <NavigationRail {...props} /> : <BottomTabBar {...props} />;
}

/**
 * The bottom bar: a full-width surface on the bottom edge, with Sessions and Tasks on the left,
 * Host and Settings on the right, and the create button in a cradle in the middle. The surface
 * goes under the Android navigation buttons. The create button opens New Task, New Chat, and
 * Import on an arc over the screen. The bar hides while the keyboard shows.
 */
function BottomTabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const surfaceHeight = TAB_BAR.height + bottom;
  const keyboardVisible = useKeyboardState((keyboard) => keyboard.isVisible);
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
    placement: "bottom",
    onPressTab: pressTab,
  });

  return (
    <>
      {menuMounted ? <CreateFan placement="bottom" progress={progress} onClose={close} /> : null}
      {/* The bar stays mounted while the keyboard hides it. A sheet that closes with the keyboard,
          such as Rename Chat, then does not mount the whole bar in the frame of its close. */}
      <View pointerEvents="box-none" style={[styles.dock, keyboardVisible && styles.hidden]}>
        {/* The bar takes the touches under its cradle, also in the bottom safe area, so a tap
            there never reaches a row behind the bar. The surface draws over it. A view needs a
            background to stop the touch on Android. */}
        <View style={styles.touchShield} />
        {/* The view box starts one point above the bar, so the hairline of the top edge shows
            in full. */}
        <Svg
          pointerEvents="none"
          width={width}
          height={surfaceHeight + EDGE_ROOM}
          viewBox={`0 ${-EDGE_ROOM} ${width} ${surfaceHeight + EDGE_ROOM}`}
          style={styles.surface}
        >
          <Path d={tabBarPath(width, surfaceHeight)} fill={theme.colors.surface} />
          <Path
            d={tabBarEdgePath(width)}
            fill="none"
            stroke={theme.colors.border}
            strokeWidth={theme.hairline}
          />
        </Svg>
        <View accessibilityRole={TAB_ROW_ROLE} style={styles.row}>
          {tabs.slice(0, CREATE_SLOT)}
          <View style={styles.createSlot} />
          {tabs.slice(CREATE_SLOT)}
        </View>
        <View pointerEvents="box-none" style={styles.createAnchor}>
          <CreateButton
            open={open}
            progress={progress}
            hitSlop={CREATE_HIT_SLOP}
            onPress={toggle}
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme, runtime) => ({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: CREATE_RISE,
    paddingBottom: runtime.insets.bottom,
  },
  hidden: { display: "none" },
  touchShield: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: CREATE_RISE + CRADLE_DEPTH,
    backgroundColor: theme.colors.surface,
  },
  surface: { position: "absolute", left: 0, top: CREATE_RISE - EDGE_ROOM },
  // A tablet keeps the tabs at phone width, centered on the cradle. The side insets stay equal,
  // so the cradle stays in the middle of the row. The outer tabs reach the screen edges, so a tap
  // at an edge selects them.
  row: {
    width: "100%",
    maxWidth: TAB_BAR.maxRowWidth + 2 * Math.max(runtime.insets.left, runtime.insets.right),
    alignSelf: "center",
    height: TAB_BAR.height,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Math.max(runtime.insets.left, runtime.insets.right),
  },
  createSlot: { width: 2 * CRADLE_HALF_WIDTH },
  // The anchor reaches the bottom of the row, so the touch slop of the button under it stays
  // inside its parent. iOS finds no touch target outside the bounds of a parent.
  createAnchor: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CREATE_RISE + TAB_BAR.height,
    alignItems: "center",
  },
}));
