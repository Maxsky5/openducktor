import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { type ReactElement, useEffect, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StyleSheet } from "react-native-unistyles";
import {
  AppServicesProvider,
  useFeedbackStore,
  useHostSessionState,
} from "@/app-shell/app-services";
import { ConnectionTree } from "@/app-shell/connection-tree";
import { createAppServices } from "@/app-shell/create-app-services";
import { InvalidRecordScreen, SwitchingHostScreen } from "@/app-shell/startup-screens";
import { FeedbackHost } from "@/feedback/feedback-host";
import { SwipeBackProvider } from "@/navigation/swipe-back-detector";
import { AppThemeProvider, useAppTheme } from "@/theme/app-theme-context";
import { AppSystemBars } from "@/ui/app-system-bars";

void SplashScreen.preventAutoHideAsync();

function RootNavigator(): ReactElement {
  const state = useHostSessionState();
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  if (state.status === "invalid_record") return <InvalidRecordScreen invalid={state.invalid} />;
  if (state.status === "switching") return <SwitchingHostScreen label={state.host.label} />;
  const active = state.status === "active" ? state.session : null;
  const navigator = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={active === null}>
        <Stack.Screen name="(setup)" />
      </Stack.Protected>
      <Stack.Protected guard={active !== null}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
  if (!active) return navigator;
  return (
    <ConnectionTree key={active.sessionKey} session={active}>
      {navigator}
    </ConnectionTree>
  );
}

/** The status bar and the Android navigation buttons follow the app theme, not the system theme. */
function ThemedSystemBars(): ReactElement {
  const theme = useAppTheme();
  return <AppSystemBars icons={theme.scheme === "dark" ? "light" : "dark"} />;
}

function FeedbackLayer(): ReactElement {
  return <FeedbackHost feedback={useFeedbackStore()} />;
}

export default function RootLayout(): ReactElement {
  const [services] = useState(createAppServices);
  return (
    <GestureHandlerRootView style={styles.fill}>
      {/* The theme background sits on a React Native view, so it follows a theme change. */}
      <View style={styles.root}>
        <AppThemeProvider>
          <KeyboardProvider>
            <AppServicesProvider services={services}>
              <ThemedSystemBars />
              <SwipeBackProvider>
                <RootNavigator />
              </SwipeBackProvider>
              <FeedbackLayer />
            </AppServicesProvider>
          </KeyboardProvider>
        </AppThemeProvider>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  root: { flex: 1, backgroundColor: theme.colors.background },
}));
