import { Stack } from "expo-router";
import { type PropsWithChildren, type ReactElement, use, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { ConnectionBanner } from "@/host-session/connection-banner";
import { ConnectionStatusSlot } from "@/host-session/connection-status-slot";
import { NavigationRailContext } from "@/navigation/tab-bar/navigation-rail-context";
import { CREATE_RISE } from "@/navigation/tab-bar/tab-bar-geometry";
import { useAppTheme } from "@/theme/app-theme-context";

/**
 * `sidebar` is the white surface of the desktop sidebar, for the session list. `sheet` is the
 * white surface of a desktop dialog, for route sheets.
 */
type Background = "plain" | "grouped" | "sidebar" | "sheet";

/**
 * A screen gives its navigation bar its own background, so both read as one surface. The options
 * change only with the color: each new options object renders the whole navigator again.
 */
function TintedHeader({ background }: { background: Exclude<Background, "plain"> }): ReactElement {
  const theme = useAppTheme();
  const color = {
    grouped: theme.colors.groupedBackground,
    sidebar: theme.desktop.sidebar,
    sheet: theme.desktop.popover,
  }[background];
  const options = useMemo(
    () => ({
      headerStyle: { backgroundColor: color },
      headerLargeStyle: { backgroundColor: color },
      contentStyle: { backgroundColor: color },
    }),
    [color],
  );
  return <Stack.Screen options={options} />;
}

/**
 * A screen in the connection tree. It shows the connection banner above its content, except while
 * the screen shows the full-screen connection state, so the status shows once. A screen that
 * shows the connection status itself, such as Hosts, passes `banner={false}`.
 */
export function Screen({
  children,
  background = "plain",
  banner = true,
}: PropsWithChildren<{ background?: Background; banner?: boolean }>): ReactElement {
  styles.useVariants({ background });
  const besideRail = use(NavigationRailContext);
  const [fullStates, setFullStates] = useState(0);
  const slot = useMemo(
    () => ({
      claim: () => {
        setFullStates((count) => count + 1);
        return () => setFullStates((count) => count - 1);
      },
    }),
    [],
  );
  return (
    <View style={[styles.screen, besideRail && styles.besideRail]}>
      {background === "plain" ? null : <TintedHeader background={background} />}
      {banner && fullStates === 0 ? <ConnectionBanner /> : null}
      <ConnectionStatusSlot value={slot}>
        <View style={styles.content}>{children}</View>
      </ConnectionStatusSlot>
    </View>
  );
}

/**
 * The bottom padding of a scroll view that ends at the bottom edge of a pushed screen: `space`,
 * plus the bottom safe area on Android. The app draws edge to edge, so the Android navigation
 * buttons cover the bottom of the screen, and the safe area lets the last rows scroll clear of
 * them. On iOS, the scroll view sets `contentInsetAdjustmentBehavior="automatic"` and adds the
 * safe area itself.
 */
export const useScreenEndSpace = (space: number): number => {
  const { bottom } = useSafeAreaInsets();
  return Platform.OS === "ios" ? space : space + bottom;
};

/** A screen outside the connection tree, such as Add host. */
export function PlainScreen({
  children,
  background = "plain",
}: PropsWithChildren<{ background?: Background }>): ReactElement {
  styles.useVariants({ background });
  return (
    <View style={styles.screen}>
      {background === "plain" ? null : <TintedHeader background={background} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  // In landscape, the side insets keep the content clear of the notch and the rounded corners.
  // The background still fills them. The navigation rail already takes the left inset.
  screen: {
    flex: 1,
    paddingLeft: rt.insets.left,
    paddingRight: rt.insets.right,
    variants: {
      background: {
        plain: { backgroundColor: theme.colors.background },
        grouped: { backgroundColor: theme.colors.groupedBackground },
        sidebar: { backgroundColor: theme.desktop.sidebar },
        sheet: { backgroundColor: theme.desktop.popover },
      },
    },
  },
  // The rail takes the left safe area, and its create button rises past its edge by this much.
  besideRail: { paddingLeft: CREATE_RISE },
  content: { flex: 1 },
}));
