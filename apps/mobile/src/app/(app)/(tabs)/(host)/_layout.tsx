import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { rootScreenOptions, useNativeStackTheme } from "@/navigation/stack-theme";
import { screenLayout } from "@/navigation/screen-layout";
import { withAndroidHeader } from "@/navigation/stack-header";
import { useSwipeBackNativeProps } from "@/navigation/swipe-back";

export const unstable_settings = { initialRouteName: "host/index" };

/** The host tab: the saved hosts and the connection of this device, then its diagnostics. */
export default function HostLayout(): ReactElement {
  return (
    <Stack
      screenOptions={withAndroidHeader(useNativeStackTheme("grouped"))}
      screenLayout={screenLayout}
      unstable_nativeProps={useSwipeBackNativeProps()}
    >
      <Stack.Screen name="host/index" options={{ ...rootScreenOptions, title: "Host" }} />
      <Stack.Screen name="host/diagnostics" options={{ title: "Diagnostics" }} />
    </Stack>
  );
}
