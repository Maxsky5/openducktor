import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

/**
 * The label above each demo screen. It takes its own row, so it covers no content, and it does
 * not scroll.
 */
export function DemoModeLabel(): ReactElement {
  const theme = useAppTheme();
  return (
    <View
      style={styles.label}
      accessible
      accessibilityRole="text"
      accessibilityLabel="Demo mode. Sample data on this device."
    >
      <Icon name="flask-conical" size={13} colorValue={theme.desktop.selectedAccent} />
      <Text variant="footnote" weight="medium" numberOfLines={1} style={styles.text}>
        Demo mode
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  label: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.xs,
    paddingVertical: theme.space.xs,
    paddingHorizontal: theme.layout.screenPadding,
    backgroundColor: withAlpha(theme.desktop.selectedAccent, 0.1),
    borderBottomWidth: theme.hairline,
    borderBottomColor: withAlpha(theme.desktop.selectedAccent, 0.3),
  },
  text: { color: theme.desktop.selectedAccent, flexShrink: 1 },
}));
