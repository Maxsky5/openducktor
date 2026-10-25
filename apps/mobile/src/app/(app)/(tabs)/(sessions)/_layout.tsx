import { Stack } from "expo-router";
import { SessionNavigationProvider } from "@/features/sessions/session-navigation-provider";
import type { ReactElement } from "react";
import { useNativeStackTheme } from "@/navigation/stack-theme";
import { screenLayout } from "@/navigation/screen-layout";
import { withAndroidHeader } from "@/navigation/stack-header";
import { useSwipeBackNativeProps } from "@/navigation/swipe-back";

export const unstable_settings = { initialRouteName: "index" };

/**
 * The Sessions tab: the session list of every workspace, then the archived chats. The session
 * model wraps this stack only (see `SessionNavigationProvider`).
 */
export default function SessionsLayout(): ReactElement {
  return (
    <SessionNavigationProvider>
      <Stack
        screenOptions={withAndroidHeader(useNativeStackTheme())}
        screenLayout={screenLayout}
        unstable_nativeProps={useSwipeBackNativeProps()}
      />
    </SessionNavigationProvider>
  );
}
