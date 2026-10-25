import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sansWeight } from "@/theme/tokens";
import { Text } from "@/ui/text";

/**
 * The desktop `AgentTranscriptSeparator`: a label between hairlines, such as "Worked for 53s"
 * or a fork boundary.
 */
export const SeparatorRow = memo(function SeparatorRow({
  label,
  accessibilityLabel,
}: {
  label: string;
  accessibilityLabel?: string | undefined;
}): ReactElement {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <View style={styles.line} />
      <Text numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      <View style={styles.line} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop `flex items-center gap-3 px-1 pt-8 pb-2`.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.xs,
    paddingTop: theme.space.xxxl,
    paddingBottom: theme.space.sm,
  },
  line: { flex: 1, height: 1, backgroundColor: theme.desktop.border },
  label: {
    ...sansWeight("medium"),
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: 0.3,
    color: theme.desktop.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
}));
