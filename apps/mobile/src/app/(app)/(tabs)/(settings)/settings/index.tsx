import type { ReactElement } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useDevicePreferences, useDevicePreferencesActions } from "@/app-shell/app-services";
import type { ThemePreference } from "@/device-data/device-records";
import { Callout } from "@/ui/callout";
import {
  AppVersionFooter,
  DividedCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from "@/ui/settings-layout";
import { THEME_PREFERENCES } from "@/features/settings/theme-preference";
import { Button } from "@/ui/button";
import { SegmentedControl } from "@/ui/fields";
import { useTabBarSpace } from "@/navigation/tab-bar/tab-bar-metrics";
import { appVersionLabel } from "@/platform/app-version";
import { Screen } from "@/ui/screen";

const APP_VERSION = appVersionLabel();

/** Short names, so the three choices fit one segmented control on a phone. */
const THEME_SEGMENT_LABELS = {
  system: "System",
  light: "Light",
  dark: "Dark",
} satisfies Record<ThemePreference, string>;

const THEME_OPTIONS = THEME_PREFERENCES.map((value) => ({
  value,
  label: THEME_SEGMENT_LABELS[value],
}));

/**
 * The settings tab: the device preferences, as the desktop Appearance and Chat settings
 * sections, and the app version. The host theme setting belongs to all clients of a host, so it
 * stays there.
 */
export default function SettingsScreen(): ReactElement {
  const tabBarSpace = useTabBarSpace({ automaticInsets: true });
  const preferences = useDevicePreferences((state) => state.preferences);
  const invalid = useDevicePreferences((state) => state.invalid);
  const { update, reset } = useDevicePreferencesActions();
  return (
    <Screen background="grouped">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]}
      >
        {invalid ? (
          <Callout
            tone="warning"
            title={`${invalid.name} cannot be read`}
            message={invalid.message}
            action={
              <Button label="Reset Preferences" size="sm" variant="outline" onPress={reset} />
            }
          />
        ) : null}
        <SettingsSection
          title="Appearance"
          description="Choose how OpenDucktor looks on this device."
        >
          <DividedCard>
            <SettingsRow
              title="Theme"
              description="System follows the light or dark setting of this device. Light and Dark keep the chosen look."
            >
              <SegmentedControl
                label="Theme"
                options={THEME_OPTIONS}
                value={preferences.theme}
                onChange={(theme) => update({ theme })}
              />
            </SettingsRow>
          </DividedCard>
        </SettingsSection>
        <SettingsSection
          title="Chat"
          description="Display settings for session transcripts on this device."
        >
          <DividedCard>
            <SettingsSwitchRow
              title="Show Thinking Messages"
              description="Thinking messages are hidden by default. Turn this on to show them in session transcripts."
              value={preferences.showReasoning}
              onValueChange={(showReasoning) => update({ showReasoning })}
            />
          </DividedCard>
        </SettingsSection>
        <AppVersionFooter version={APP_VERSION} />
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
}));
