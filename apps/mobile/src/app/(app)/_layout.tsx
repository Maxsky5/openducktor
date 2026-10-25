import { Stack } from "expo-router";
import type { ReactElement } from "react";
import {
  choiceSheetOptions,
  compactSheetOptions,
  fullSheetOptions,
  sheetOptions,
} from "@/navigation/sheet-options";
import { useNativeStackTheme } from "@/navigation/stack-theme";
import { screenLayout } from "@/navigation/screen-layout";
import { withAndroidHeader } from "@/navigation/stack-header";
import { useSwipeBackNativeProps } from "@/navigation/swipe-back";
import { WorkspaceModelCatalogs } from "@/composition/workspace-model-catalogs";
import { sessionRouteOptions } from "@/features/session/header/session-route-options";
import { useAppTheme } from "@/theme/app-theme-context";

/** Sessions, tasks, and work views are pushed screens. The other routes are sheets. */
const isPushedScreen = (name: string): boolean =>
  name === "session" || name.startsWith("task/") || name.startsWith("work/");

/** The tabs, plus sheets that open above any tab. */
export default function AppLayout(): ReactElement {
  const theme = useNativeStackTheme();
  const { colors } = useAppTheme();
  const swipeBack = useSwipeBackNativeProps(isPushedScreen);
  return (
    <>
      <WorkspaceModelCatalogs />
      <Stack
        screenOptions={withAndroidHeader(theme, isPushedScreen)}
        screenLayout={screenLayout}
        unstable_nativeProps={swipeBack}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="session" options={sessionRouteOptions} />
        <Stack.Screen name="workspace-switcher" options={sheetOptions("Workspaces")} />
        <Stack.Screen name="new-task" options={fullSheetOptions("New Task")} />
        <Stack.Screen name="edit-task" options={fullSheetOptions("Edit Task")} />
        <Stack.Screen name="import-issues" options={fullSheetOptions("Import Issues")} />
        <Stack.Screen name="start-session" options={fullSheetOptions("Start Session")} />
        <Stack.Screen name="approve-task" options={fullSheetOptions("Approve Task")} />
        <Stack.Screen name="request-changes" options={fullSheetOptions("Request Changes")} />
        <Stack.Screen name="new-chat" options={fullSheetOptions("New Chat")} />
        <Stack.Screen name="rename-chat" options={compactSheetOptions(colors.surface)} />
        <Stack.Screen name="archive-chat" options={compactSheetOptions(colors.surface)} />
        <Stack.Screen name="fork-chat" options={fullSheetOptions("Fork Chat")} />
        <Stack.Screen name="composer-options" options={choiceSheetOptions("Message Options")} />
        <Stack.Screen name="add-host" options={compactSheetOptions(colors.surface)} />
        <Stack.Screen
          name="scan-host"
          options={{ presentation: "fullScreenModal", title: "Scan QR Code", headerShown: false }}
        />
      </Stack>
    </>
  );
}
