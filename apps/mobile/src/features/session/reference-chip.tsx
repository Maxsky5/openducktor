import type { AgentFileSearchResultKind } from "@openducktor/core";
import { memo, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import {
  type ReferenceChipKind,
  referenceChipColors,
  referenceChipIcon,
} from "./reference-chip-paint";

export type ReferenceChipProps = {
  kind: ReferenceChipKind;
  label: string;
  /** The file kind of a file chip. It picks the icon. */
  fileKind?: AgentFileSearchResultKind | undefined;
  /** `compact` is the desktop message queue size: 20 high with 11-point text. */
  size?: "default" | "compact";
  /** A control at the end of the chip, such as a remove button in the composer. */
  trailing?: ReactNode;
};

/**
 * A file, skill, subagent, or Slash Command reference as the desktop chip: a capsule 24 high with
 * a 14-point icon and a 12-point medium label. It can sit inline in a text.
 */
export const ReferenceChip = memo(function ReferenceChip({
  kind,
  label,
  fileKind = "default",
  size = "default",
  trailing,
}: ReferenceChipProps): ReactElement {
  const theme = useAppTheme();
  const colors = referenceChipColors(theme, kind);
  const icon = referenceChipIcon(kind, fileKind);
  const compact = size === "compact";
  return (
    <View
      style={[
        styles.chip,
        compact ? styles.compactChip : styles.defaultChip,
        { backgroundColor: colors.backgroundColor, borderColor: colors.borderColor },
      ]}
    >
      {icon ? <Icon name={icon} size={compact ? 12 : 14} colorValue={colors.color} /> : null}
      <Text
        numberOfLines={1}
        ellipsizeMode="middle"
        style={[
          styles.label,
          compact ? styles.compactLabel : styles.defaultLabel,
          { color: colors.color },
        ]}
      >
        {label}
      </Text>
      {trailing}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: theme.radius.pill,
  },
  // Messages and composers render many chips, so a chip picks plain style entries for its size
  // instead of stylesheet variants, which run native code on each render.
  compactChip: { height: 20, gap: 4, paddingHorizontal: 8 },
  defaultChip: { height: 24, gap: 6, paddingHorizontal: 10 },
  label: {
    flexShrink: 1,
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
  },
  compactLabel: { fontSize: 11, lineHeight: 14 },
  defaultLabel: { fontSize: 12, lineHeight: 16 },
}));
