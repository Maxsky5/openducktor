import { memo, type ReactElement } from "react";
import { useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { themeStyleCache } from "@/theme/theme-style-cache";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import type { Tone } from "./tones";

export type BadgeProps = {
  label: string;
  tone?: Tone | undefined;
  icon?: IconName | undefined;
  /** A colored dot before the label, as the desktop priority badge. */
  dot?: boolean | undefined;
  /** A screen reader name when the visible label is short, such as "P1". */
  accessibilityLabel?: string | undefined;
};

/** The plain styles of a tone. Lists render many badges, so a badge calls no style function. */
const toneStyles = themeStyleCache((theme, tone: Tone) => {
  const colors = theme.tones[tone];
  return {
    box: { backgroundColor: colors.surface, borderColor: colors.border },
    text: { color: colors.text },
    dot: { backgroundColor: colors.accent },
    halo: { boxShadow: `0 0 0 3px ${colors.surface}` },
  };
});

/**
 * The desktop badge: a capsule with a colored wash, an outline, and colored text. The text
 * carries the meaning, so color is never the only signal.
 */
export const Badge = memo(function Badge({
  label,
  tone = "neutral",
  icon,
  dot = false,
  accessibilityLabel,
}: BadgeProps): ReactElement {
  const toned = toneStyles(useAppTheme(), tone);
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.badge, toned.box]}
    >
      {icon ? <Icon name={icon} size={12} colorStyle={toned.text} /> : null}
      {dot ? <View style={[styles.dot, toned.dot]} /> : null}
      <Text variant="caption2" numberOfLines={1} style={toned.text}>
        {label}
      </Text>
    </View>
  );
});

/** A badge for a first load: the capsule of a badge, as tall as a badge with a label. */
export function BadgePlaceholder({ width }: { width: number }): ReactElement {
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.badge, styles.placeholder(width, fontScale)]} />;
}

/** A status as a colored dot and a word, as the desktop sidebar rows ("running"). */
export const StatusLabel = memo(function StatusLabel({
  label,
  tone,
  pulse = false,
}: {
  label: string;
  tone: Tone;
  /** True for a live state, such as Running. */
  pulse?: boolean;
}): ReactElement {
  const toned = toneStyles(useAppTheme(), tone);
  return (
    <View style={styles.status} accessible accessibilityLabel={label}>
      <StatusDot tone={tone} pulse={pulse} />
      <Text variant="footnote" weight="medium" numberOfLines={1} style={toned.text}>
        {label}
      </Text>
    </View>
  );
});

/**
 * A colored dot next to a text label. A live dot has a soft halo. It does not animate, so a
 * screen of live rows draws no frames while nothing changes.
 */
const StatusDot = memo(function StatusDot({
  tone,
  size = 8,
  pulse = false,
}: {
  tone: Tone;
  size?: number;
  pulse?: boolean;
}): ReactElement {
  const toned = toneStyles(useAppTheme(), tone);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width: size, height: size, borderRadius: size / 2 },
        toned.dot,
        pulse ? toned.halo : null,
      ]}
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    minHeight: 22,
    paddingHorizontal: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  // The outlined `caption2` label line, and never less than the minimum height of a badge.
  placeholder: (width: number, fontScale: number) => ({
    width,
    height: Math.max(22, theme.type.caption2.lineHeight * fontScale + 2),
    backgroundColor: theme.colors.fill,
    borderColor: theme.colors.fill,
  }),
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
}));
