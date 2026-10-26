import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { useNativeStackTheme } from "@/navigation/stack-theme";
import { screenLayout } from "@/navigation/screen-layout";
import { withAndroidHeader } from "@/navigation/stack-header";
import { useSwipeBackNativeProps } from "@/navigation/swipe-back";

/** The Tasks tab: the task board of the selected workspace. */
export default function TasksLayout(): ReactElement {
  return (
    <Stack
      screenOptions={withAndroidHeader(useNativeStackTheme())}
      screenLayout={screenLayout}
      unstable_nativeProps={useSwipeBackNativeProps()}
    />
  );
}
