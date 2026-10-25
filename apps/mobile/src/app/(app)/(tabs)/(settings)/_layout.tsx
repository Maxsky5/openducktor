import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { rootScreenOptions, useNativeStackTheme } from "@/navigation/stack-theme";
import { screenLayout } from "@/navigation/screen-layout";
import { withAndroidHeader } from "@/navigation/stack-header";
import { useSwipeBackNativeProps } from "@/navigation/swipe-back";

export const unstable_settings = { initialRouteName: "settings/index" };

/** The settings tab: the preferences of this device. */
export default function SettingsLayout(): ReactElement {
  return (
    <Stack
      screenOptions={withAndroidHeader(useNativeStackTheme("grouped"))}
      screenLayout={screenLayout}
      unstable_nativeProps={useSwipeBackNativeProps()}
    >
      <Stack.Screen name="settings/index" options={{ ...rootScreenOptions, title: "Settings" }} />
    </Stack>
  );
}
