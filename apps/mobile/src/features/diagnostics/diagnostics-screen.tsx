import { Stack } from "expo-router";
import { type ReactElement, useCallback } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Icon } from "@/ui/icon";
import { Screen } from "@/ui/screen";
import { Touchable } from "@/ui/touchable";
import {
  DiagnosticsHostGroup,
  DiagnosticsOverview,
  DiagnosticsWorkspaceGroup,
} from "./diagnostics-sections";
import { useDiagnosticsModel } from "./use-diagnostics-model";
import { useTabBarSpace } from "@/navigation/tab-bar/tab-bar-metrics";
import { ListRefreshControl } from "@/ui/refresh-control";
import { usePullRefresh } from "@/ui/use-pull-refresh";
import { useCommandGate } from "@/host-session/active-session-context";

/**
 * The desktop Refresh control of the diagnostics sheet: an outlined square whose icon turns while
 * the checks run. It takes no press while they run, and it is off while the connection is not live.
 */
function RefreshButton({
  refreshing,
  live,
  onPress,
}: {
  refreshing: boolean;
  live: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      disabled={refreshing || !live}
      dimWhenDisabled={!refreshing}
      radius={theme.radius.md}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={refreshing ? "Refreshing checks" : "Refresh checks"}
      accessibilityHint={live ? undefined : "Available when the host connection is live."}
      accessibilityState={{ busy: refreshing }}
      style={styles.refresh}
    >
      {refreshing ? (
        <LoaderSpinner size={16} color={theme.desktop.mutedForeground} />
      ) : (
        <Icon name="refresh" size={16} colorValue={theme.desktop.foreground} />
      )}
    </Touchable>
  );
}

/**
 * The desktop diagnostics panel for the host of this connection and the workspace that this app
 * shows: the verdict, the host runtimes and tools, and the workspace checks. Host settings and
 * runtime restarts stay in the desktop and web apps.
 */
export function DiagnosticsScreen(): ReactElement {
  const tabBarSpace = useTabBarSpace({ automaticInsets: true });
  const { model, isRefreshing, refresh } = useDiagnosticsModel();
  const live = useCommandGate().open;
  // The pull indicator shows only for a refresh that a pull started. A programmatic refresh
  // indicator moves the content of a native scroll view.
  const { pulling, pull } = usePullRefresh(refresh);
  const runRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const headerRight = useCallback(
    () => <RefreshButton refreshing={isRefreshing} live={live} onPress={runRefresh} />,
    [isRefreshing, live, runRefresh],
  );
  return (
    <Screen background="grouped">
      <Stack.Screen options={{ headerRight }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]}
        refreshControl={
          live ? <ListRefreshControl refreshing={pulling} onRefresh={pull} /> : undefined
        }
      >
        <DiagnosticsOverview overview={model.overview} />
        <DiagnosticsHostGroup host={model.host} />
        <DiagnosticsWorkspaceGroup workspace={model.workspace} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    width: "100%",
    maxWidth: theme.layout.readableWidth,
    alignSelf: "center",
    gap: theme.space.xxl,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.lg,
  },
  refresh: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
}));
