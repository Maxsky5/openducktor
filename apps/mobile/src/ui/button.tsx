import type { ReactElement } from "react";
import {
  type StyleProp,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandBlocked } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { type AppTheme, radius, verticalTouchSlop } from "@/theme/tokens";
import type { AgentRole } from "@openducktor/core";
import { RoleIcon } from "./brand-icons";
import { Icon, type IconName } from "./icon";
import { LoaderSpinner } from "./loader-spinner";
import { Text } from "./text";
import { Touchable } from "./touchable";

/**
 * The desktop button styles. `filled` is the one violet action of a view. `outline` is a white
 * secondary action with an outline, as "Start Spec" on desktop. `tinted` is a violet wash.
 * `gray` is a quiet action. `plain` is a text action. `destructive` is solid red: it removes or
 * stops something. `warning` is the amber desktop warning button.
 */
export type ButtonVariant =
  | "filled"
  | "outline"
  | "tinted"
  | "gray"
  | "plain"
  | "destructive"
  | "warning";

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  icon?: IconName | undefined;
  /** A Workflow Role whose icon replaces `icon`, as on the desktop role actions. */
  roleIcon?: AgentRole | undefined;
  /** An icon after the label, such as the chevron of a Next action. */
  trailingIcon?: IconName | undefined;
  /** Shows progress and disables the button while an action runs. */
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  /** True when the press sends a host command. The button follows the connection command gate. */
  command?: boolean | undefined;
  /** Replaces `label` for screen readers when the label alone is ambiguous. */
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  /** Stretches the button to the width of its container. */
  fill?: boolean | undefined;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
};

const HEIGHTS = { sm: 32, md: 40, lg: 48 } as const;
const ICON_SIZES = { sm: 14, md: 16, lg: 18 } as const;
/** A short button keeps its look and gets a taller touch area. Its width is enough already. */
const SLOPS = {
  sm: verticalTouchSlop(HEIGHTS.sm),
  md: verticalTouchSlop(HEIGHTS.md),
  lg: verticalTouchSlop(HEIGHTS.lg),
};

/** The text and icon color of each style. */
const foregroundColor = (theme: AppTheme, variant: ButtonVariant): string =>
  ({
    filled: theme.colors.onTint,
    outline: theme.colors.label,
    tinted: theme.colors.tint,
    gray: theme.desktop.secondaryForeground,
    plain: theme.colors.tint,
    destructive: theme.desktop.destructiveForeground,
    warning: theme.desktop.warningMuted,
  })[variant];

/**
 * A button keeps its colors in styles, so a theme change repaints it without a render. Only a
 * role icon renders again.
 */
export function Button({
  label,
  onPress,
  variant = "filled",
  size = "md",
  icon,
  roleIcon,
  trailingIcon,
  loading = false,
  disabled = false,
  command = false,
  accessibilityLabel,
  accessibilityHint,
  fill = false,
  style,
  testID,
}: ButtonProps): ReactElement {
  const blockedByConnection = useCommandBlocked(command, label);
  const inactive = disabled || loading || blockedByConnection;
  // As on desktop, a button that cannot run keeps its look at half opacity. The variant and the
  // size pick plain style entries: a Unistyles variant would build the sheet again on each render,
  // and buttons render in list rows.
  const foreground = FOREGROUNDS[variant];
  const iconSize = ICON_SIZES[size];
  return (
    <Touchable
      testID={testID}
      feedback={variant === "plain" ? "opacity" : "scale"}
      onPress={onPress}
      disabled={inactive}
      dimWhenDisabled={!loading}
      radius={size === "lg" ? radius.lg : radius.md}
      hitSlop={SLOPS[size]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={
        blockedByConnection ? "Available when the host connection is live." : accessibilityHint
      }
      accessibilityState={{ disabled: inactive, busy: loading }}
      containerStyle={fill ? styles.fill : styles.hug}
      style={[styles.button, SURFACES[variant], SIZES[size], style]}
    >
      <View style={styles.content}>
        <LeadingIcon
          loading={loading}
          roleIcon={roleIcon}
          icon={icon}
          size={iconSize}
          variant={variant}
          foreground={foreground}
        />
        <Text numberOfLines={1} style={[styles.label, LABELS[size], foreground]}>
          {label}
        </Text>
        {trailingIcon && !loading ? (
          <Icon name={trailingIcon} size={iconSize} colorStyle={foreground} />
        ) : null}
      </View>
    </Touchable>
  );
}

/** The progress spinner while the action runs, else the role icon or the icon. */
function LeadingIcon({
  loading,
  roleIcon,
  icon,
  size,
  variant,
  foreground,
}: {
  loading: boolean;
  roleIcon: AgentRole | undefined;
  icon: IconName | undefined;
  size: number;
  variant: ButtonVariant;
  foreground: StyleProp<TextStyle>;
}): ReactElement | null {
  if (loading) return <LoaderSpinner size={size} colorStyle={foreground} />;
  if (roleIcon) return <ButtonRoleIcon role={roleIcon} size={size} variant={variant} />;
  if (icon) return <Icon name={icon} size={size} colorStyle={foreground} />;
  return null;
}

/** The role icon of a button. A theme change renders only this icon again. */
function ButtonRoleIcon({
  role,
  size,
  variant,
}: {
  role: AgentRole;
  size: number;
  variant: ButtonVariant;
}): ReactElement {
  const theme = useAppTheme();
  return <RoleIcon role={role} size={size} color={foregroundColor(theme, variant)} />;
}

/** The line height of the label of each size. */
const LABEL_LINE_HEIGHTS = { sm: 18, md: 20, lg: 20 } as const;

/** A button for a first load: the box of a button of `size`, as tall as one with a label. */
export function ButtonPlaceholder({
  size = "md",
  width,
}: {
  size?: "sm" | "md" | "lg";
  width: number;
}): ReactElement {
  const { fontScale } = useWindowDimensions();
  return <View style={styles.placeholder(size, width, fontScale)} />;
}

const styles = StyleSheet.create((theme) => ({
  hug: { alignSelf: "flex-start" },
  fill: { alignSelf: "stretch", flexGrow: 1 },
  button: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  filled: { backgroundColor: theme.colors.tintFill, boxShadow: theme.shadows.primary },
  // The desktop outline button: the card color inside the input border.
  outline: { backgroundColor: theme.desktop.card, borderColor: theme.desktop.input },
  tinted: { backgroundColor: theme.colors.tintSoft, borderColor: theme.colors.tintBorder },
  // The desktop secondary button.
  gray: {
    backgroundColor: withAlpha(theme.desktop.secondary, 0.7),
    borderColor: theme.desktop.border,
  },
  plain: { backgroundColor: "transparent" },
  // The desktop destructive button: solid red with white text.
  destructive: { backgroundColor: theme.desktop.destructive },
  warning: {
    backgroundColor: theme.desktop.warningSurface,
    borderColor: theme.desktop.warningBorder,
  },
  sm: { minHeight: HEIGHTS.sm, paddingHorizontal: 12 },
  md: { minHeight: HEIGHTS.md, paddingHorizontal: 16 },
  lg: { minHeight: HEIGHTS.lg, paddingHorizontal: 20 },
  content: { flexDirection: "row", alignItems: "center", gap: 6 },
  placeholder: (size: "sm" | "md" | "lg", width: number, fontScale: number) => ({
    width,
    height: Math.max(HEIGHTS[size], LABEL_LINE_HEIGHTS[size] * fontScale + 2),
    borderRadius: size === "lg" ? radius.lg : radius.md,
    borderCurve: "continuous",
    backgroundColor: theme.colors.fill,
  }),
  // The desktop button text: medium weight.
  label: {
    ...theme.type.headline,
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
  },
  labelSm: { fontSize: 13, lineHeight: LABEL_LINE_HEIGHTS.sm },
  labelMd: { fontSize: 14, lineHeight: LABEL_LINE_HEIGHTS.md },
  labelLg: { fontSize: 15, lineHeight: LABEL_LINE_HEIGHTS.lg },
  foregroundFilled: { color: foregroundColor(theme, "filled") },
  foregroundOutline: { color: foregroundColor(theme, "outline") },
  foregroundTinted: { color: foregroundColor(theme, "tinted") },
  foregroundGray: { color: foregroundColor(theme, "gray") },
  foregroundPlain: { color: foregroundColor(theme, "plain") },
  foregroundDestructive: { color: foregroundColor(theme, "destructive") },
  foregroundWarning: { color: foregroundColor(theme, "warning") },
}));

const SURFACES = {
  filled: styles.filled,
  outline: styles.outline,
  tinted: styles.tinted,
  gray: styles.gray,
  plain: styles.plain,
  destructive: styles.destructive,
  warning: styles.warning,
};
const SIZES = { sm: styles.sm, md: styles.md, lg: styles.lg };
const LABELS = { sm: styles.labelSm, md: styles.labelMd, lg: styles.labelLg };
const FOREGROUNDS = {
  filled: styles.foregroundFilled,
  outline: styles.foregroundOutline,
  tinted: styles.foregroundTinted,
  gray: styles.foregroundGray,
  plain: styles.foregroundPlain,
  destructive: styles.foregroundDestructive,
  warning: styles.foregroundWarning,
};
