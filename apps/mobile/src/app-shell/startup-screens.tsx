import { type ReactElement, useEffect } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";
import Animated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import type { InvalidDeviceRecord } from "@/device-data/device-records";
import { useAppTheme } from "@/theme/app-theme-context";
import { DELAYED_FADE_IN } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { ErrorState } from "@/ui/states";
import { Text } from "@/ui/text";
import { useHostSessionOwner } from "./app-services";

/**
 * Shows while the app releases one host and connects to the next. The switch needs no action. A
 * screen reader hears the switch at once, as VoiceOver has no live regions.
 */
export function SwitchingHostScreen({ label }: { label: string }): ReactElement {
  const theme = useAppTheme();
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Switching hosts. Leaving ${label}.`);
  }, [label]);
  return (
    <View style={styles.screen}>
      <Animated.View
        style={[styles.center, DELAYED_FADE_IN]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Leaving ${label}. Saving drafts.`}
      >
        <ActivityIndicator color={theme.colors.secondaryLabel} />
        <View style={styles.copy}>
          <Text variant="headline" style={styles.centered}>
            Switching Hosts
          </Text>
          <Text variant="subhead" tone="secondary" style={styles.centered}>
            Saving drafts and leaving {label}.
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * A saved host record that the app cannot read at all. The reset removes that record and every
 * saved host. A damaged host entry shows in the host list instead.
 */
export function InvalidRecordScreen({ invalid }: { invalid: InvalidDeviceRecord }): ReactElement {
  const owner = useHostSessionOwner();
  return (
    <View style={styles.screen}>
      <ErrorState
        title={`${invalid.name} cannot be read`}
        message={`${invalid.message} Reset ${invalid.name} to continue. The reset removes every saved host, and their unsent drafts do not come back. Add your hosts again after the reset.`}
        action={
          <Button
            label={`Reset ${invalid.name}`}
            variant="destructive"
            onPress={() => owner.resetInvalidRecord()}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.lg,
    paddingHorizontal: theme.space.xxxl,
  },
  copy: { alignItems: "center", gap: theme.space.xs },
  centered: { textAlign: "center", maxWidth: 360 },
}));
