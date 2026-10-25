import type { PropsWithChildren, ReactElement } from "react";
import { ScrollView, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sansWeight } from "@/theme/tokens";
import { Text } from "@/ui/text";

export type SessionPanelVariant = "inline" | "side";

/** A section of the side panel of a wide screen: the desktop panel header and an open list. */
export function SidePanelSection({
  title,
  count,
  accessibilityLabel,
  style,
  children,
}: PropsWithChildren<{
  title: string;
  count: string;
  accessibilityLabel: string;
  style?: ViewStyle | undefined;
}>): ReactElement {
  return (
    <View style={[styles.side, style]}>
      <View
        style={styles.sideHeader}
        accessible
        accessibilityRole="header"
        accessibilityLabel={accessibilityLabel}
      >
        <Text variant="subhead" weight="semibold" numberOfLines={1} style={styles.sideTitle}>
          {title}
        </Text>
        <Text tabular style={styles.count}>
          {count}
        </Text>
      </View>
      <ScrollView style={styles.sideScroll} contentContainerStyle={styles.sideList}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  count: {
    ...sansWeight("medium"),
    fontSize: 11,
    lineHeight: 14,
    color: theme.desktop.mutedForeground,
  },
  side: { minHeight: 0, flexShrink: 1 },
  sideScroll: { flexShrink: 1 },
  sideHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.xl,
    paddingBottom: theme.space.sm,
  },
  sideTitle: { color: theme.desktop.foreground },
  sideList: { paddingHorizontal: theme.space.sm, paddingBottom: theme.space.md },
}));
