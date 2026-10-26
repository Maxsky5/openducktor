import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { useNativeStackTheme } from "@/navigation/stack-theme";
import { screenLayout } from "@/navigation/screen-layout";

export default function SetupLayout(): ReactElement {
  return (
    <Stack screenOptions={useNativeStackTheme()} screenLayout={screenLayout}>
      {/* The welcome screen shows the app icon and its own title, so it has no navigation bar. */}
      <Stack.Screen name="index" options={{ title: "Connect", headerShown: false }} />
      <Stack.Screen
        name="scan"
        options={{ title: "Scan QR Code", presentation: "fullScreenModal", headerShown: false }}
      />
    </Stack>
  );
}
