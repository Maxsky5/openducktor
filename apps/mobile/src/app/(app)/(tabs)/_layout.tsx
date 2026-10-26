import { Tabs } from "expo-router/js-tabs";
import type { ReactElement } from "react";
import { NeedsYouCountProvider } from "@/features/sessions/needs-you-count";
import { AppTabBar } from "@/navigation/tab-bar/app-tab-bar";
import { NavigationRailContext } from "@/navigation/tab-bar/navigation-rail-context";
import { useCompactHeight } from "@/ui/use-wide-layout";

// Sessions is the first tab after a connection, and Back from another tab returns to it.
export const unstable_settings = { initialRouteName: "(sessions)" };

const renderTabBar = (props: Parameters<typeof AppTabBar>[0]): ReactElement => (
  <AppTabBar {...props} />
);

/**
 * Sessions, Tasks, Host, and Settings, with the create button in the middle of the bar. A low
 * window, such as a phone in landscape, shows the tabs in a rail on the left edge instead. Each
 * tab keeps its own stack. A tab switch shows the other tab at once, without a transition.
 */
export default function TabsLayout(): ReactElement {
  const compact = useCompactHeight();
  return (
    <NeedsYouCountProvider>
      <NavigationRailContext value={compact}>
        <Tabs
          tabBar={renderTabBar}
          backBehavior="initialRoute"
          screenOptions={{
            headerShown: false,
            animation: "none",
            tabBarPosition: compact ? "left" : "bottom",
          }}
        >
          <Tabs.Screen name="(sessions)" options={{ title: "Sessions" }} />
          {/* The board takes about 100 ms of JS to mount, so it mounts right after the first tab
            and the first switch to Tasks is instant. */}
          <Tabs.Screen name="(tasks)" options={{ title: "Tasks", lazy: false }} />
          <Tabs.Screen name="(host)" options={{ title: "Host" }} />
          <Tabs.Screen name="(settings)" options={{ title: "Settings" }} />
        </Tabs>
      </NavigationRailContext>
    </NeedsYouCountProvider>
  );
}
