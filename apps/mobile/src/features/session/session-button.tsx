import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useOptionalCommandGate } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { LoaderSpinner } from "@/ui/loader-spinner";

/** The desktop `Button` variants that the session cards use. */
export type SessionButtonVariant = "default" | "outline" | "destructive";

export type SessionButtonProps = {
  label: string;
  onPress: () => void;
  variant?: SessionButtonVariant | undefined;
  icon?: IconName | undefined;
  /** An icon after the label, such as the chevron of Next. */
  trailingIcon?: IconName | undefined;
  /** Shows the desktop loader in place of the icon and blocks presses. */
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  /** True when the press sends a host command. The button follows the connection command gate. */
  command?: boolean | undefined;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  /** Stretches the button to share the row with its siblings. */
  fill?: boolean | undefined;
};

/**
 * The desktop `Button size="sm"` of the request cards and session notices: violet `default`,
 * card `outline`, and solid red `destructive`. It is 36 points high with a 44-point touch area.
 */
export function SessionButton({
  label,
  onPress,
  variant = "default",
  icon,
  trailingIcon,
  loading = false,
  disabled = false,
  command = false,
  accessibilityLabel,
  accessibilityHint,
  fill = false,
}: SessionButtonProps): ReactElement {
  const theme = useAppTheme();
  const gate = useOptionalCommandGate();
  if (command && !gate) {
    throw new Error(`The ${label} button sends a host command outside a host connection.`);
  }
  const blockedByConnection = command && gate !== null && !gate.open;
  const inactive = disabled || loading || blockedByConnection;
  // `default` is a reserved Unistyles variant name, so the style calls it `primary`.
  styles.useVariants({ tone: variant === "default" ? "primary" : variant });
  const foreground = {
    default: theme.desktop.primaryForeground,
    outline: theme.desktop.foreground,
    destructive: theme.desktop.destructiveForeground,
  }[variant];
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      disabled={inactive}
      dimWhenDisabled={!loading}
      radius={theme.radius.md}
      hitSlop={{ top: 4, bottom: 4 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={
        blockedByConnection ? "Available when the host connection is live." : accessibilityHint
      }
      accessibilityState={{ disabled: inactive, busy: loading }}
      containerStyle={fill ? styles.fill : styles.hug}
      style={styles.button}
    >
      <View style={styles.content}>
        {loading ? (
          <LoaderSpinner size={14} color={foreground} />
        ) : icon ? (
          <Icon name={icon} size={14} colorValue={foreground} />
        ) : null}
        <Text numberOfLines={1} style={[styles.label, { color: foreground }]}>
          {label}
        </Text>
        {trailingIcon ? <Icon name={trailingIcon} size={14} colorValue={foreground} /> : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  hug: { flexShrink: 1 },
  fill: { flexGrow: 1, flexBasis: 0 },
  button: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    variants: {
      tone: {
        primary: {
          borderColor: theme.desktop.primary,
          backgroundColor: theme.desktop.primary,
          boxShadow: theme.shadows.card,
        },
        outline: { borderColor: theme.desktop.input, backgroundColor: theme.desktop.card },
        destructive: {
          borderColor: theme.desktop.destructive,
          backgroundColor: theme.desktop.destructive,
          boxShadow: theme.shadows.card,
        },
      },
    },
  },
  content: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { ...sansWeight("medium"), fontSize: 13, lineHeight: 18 },
}));
