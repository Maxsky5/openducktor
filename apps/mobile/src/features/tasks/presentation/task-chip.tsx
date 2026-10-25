import type { IssueType } from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { themeStyleCache } from "@/theme/theme-style-cache";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { type ChipPaint, chipColors, issueTypeChipPaint } from "./task-chip-paint";

export type TaskChipProps = {
  label: string;
  paint: ChipPaint;
  icon?: IconName | undefined;
  /** An icon color other than the paint icon color, such as a pull request state. */
  iconColor?: string | undefined;
  /** A colored dot before the label, as the desktop priority badge. */
  dot?: boolean | undefined;
  /** The external link mark of a desktop link badge. */
  external?: boolean | undefined;
  /** `md` is the desktop `h-6` badge. `sm` fits the dense board card. */
  size?: "sm" | "md" | undefined;
  weight?: "medium" | "semibold" | undefined;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  /** Makes the badge a link, such as a pull request that opens in the browser. */
  onPress?: (() => void) | undefined;
};

/** The plain styles of a paint. Board cards render many chips, so a chip calls no style function. */
const paintStyles = themeStyleCache((theme, paint: ChipPaint) => {
  const colors = chipColors(theme, paint);
  return {
    box: { backgroundColor: colors.surface, borderColor: colors.border },
    text: { color: colors.text },
    icon: { color: colors.icon },
    dot: { backgroundColor: colors.dot },
  };
});

/**
 * A desktop task badge: a capsule with a wash, an outline, an icon or a dot, and a label. The
 * label carries the meaning, so color is never the only signal.
 */
export const TaskChip = memo(function TaskChip({
  label,
  paint,
  icon,
  iconColor,
  dot = false,
  external = false,
  size = "md",
  weight = "semibold",
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: TaskChipProps): ReactElement {
  const iconSize = size === "sm" ? 11 : 12;
  const painted = paintStyles(useAppTheme(), paint);
  const content = (
    <>
      {icon ? (
        <Icon
          name={icon}
          size={iconSize + 1}
          colorValue={iconColor}
          colorStyle={iconColor === undefined ? painted.icon : undefined}
        />
      ) : null}
      {dot ? <View style={[styles.dot, painted.dot]} /> : null}
      <Text
        variant="caption2"
        weight={weight}
        numberOfLines={1}
        style={[styles.label, painted.text]}
      >
        {label}
      </Text>
      {external ? <Icon name="external-link" size={iconSize} colorStyle={painted.icon} /> : null}
    </>
  );
  // A chip picks a plain style entry for its size instead of a stylesheet variant, which runs
  // native code on each render.
  const chipStyle = [styles.chip, size === "sm" ? styles.small : styles.medium, painted.box];
  if (onPress) {
    return (
      <Touchable
        feedback="opacity"
        onPress={onPress}
        hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }}
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        style={chipStyle}
      >
        {content}
      </Touchable>
    );
  }
  return (
    // A badge takes no touch, so a press on it reaches the card or row under it.
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      pointerEvents="none"
      style={chipStyle}
    >
      {content}
    </View>
  );
});

/** The Lucide icon of an issue type in its desktop icon color, as the compact desktop card. */
export const IssueTypeMark = memo(function IssueTypeMark({
  issueType,
  icon,
  size = 15,
}: {
  issueType: IssueType;
  icon: IconName;
  size?: number;
}): ReactElement {
  const painted = paintStyles(useAppTheme(), issueTypeChipPaint(issueType));
  return <Icon name={icon} size={size} colorStyle={painted.icon} />;
});

const styles = StyleSheet.create((theme) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    flexShrink: 1,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  // A minimum height, so a chip grows with large system text.
  small: { minHeight: 22, gap: 4, paddingHorizontal: 8 },
  medium: { minHeight: 24, gap: 6, paddingHorizontal: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { flexShrink: 1 },
}));
