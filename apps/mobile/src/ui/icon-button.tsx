import type { ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { useCommandBlocked } from "@/host-session/active-session-context";
import { radius, type ThemeColorName, touchSlop } from "@/theme/tokens";
import { Icon, type IconName } from "./icon";
import { Touchable } from "./touchable";

export type IconButtonProps = {
  icon: IconName;
  /** Required: an icon alone has no accessible name. */
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  disabled?: boolean | undefined;
  command?: boolean | undefined;
  color?: ThemeColorName | undefined;
  /**
   * `plain` shows only the icon. `filled` puts it in a gray circle, as a sheet close control.
   * `tinted` puts it in a violet circle. `outline` is the white outlined square of desktop
   * secondary buttons. `primary` is the violet square of the main action of a screen.
   */
  variant?: "plain" | "filled" | "tinted" | "outline" | "primary" | undefined;
  selected?: boolean | undefined;
  size?: number | undefined;
  testID?: string | undefined;
};

type IconButtonVariant = NonNullable<IconButtonProps["variant"]>;

const DEFAULT_COLORS = {
  plain: "label",
  filled: "secondaryLabel",
  tinted: "tint",
  outline: "label",
  primary: "onTint",
} as const satisfies Record<IconButtonVariant, ThemeColorName>;

/** The drawn size of each variant with a background. A plain icon fills its touch area itself. */
const VARIANT_SIZE = { filled: 30, tinted: 34, outline: 36, primary: 36 } as const;

/** Squares have the medium corner radius, circles a full one, and a plain icon none. */
const variantRadius = (variant: IconButtonVariant, mediumRadius: number): number => {
  if (variant === "outline" || variant === "primary") return mediumRadius;
  return variant === "plain" ? 0 : 999;
};

/** A plain icon has the requested size. Squares have an 18-point icon, circles a smaller one. */
const variantIconSize = (variant: IconButtonVariant, size: number): number => {
  if (variant === "plain") return size;
  return variant === "primary" || variant === "outline" ? 18 : Math.round(size * 0.75);
};

/** An icon control with a touch area of the platform minimum size. */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  onLongPress,
  disabled = false,
  command = false,
  color,
  variant = "plain",
  selected,
  size = 22,
  testID,
}: IconButtonProps): ReactElement {
  const blocked = useCommandBlocked(command, accessibilityLabel);
  const inactive = disabled || blocked;
  return (
    <Touchable
      testID={testID}
      feedback={variant === "plain" ? "opacity" : "scale"}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={inactive}
      radius={variantRadius(variant, radius.md)}
      hitSlop={variant === "plain" ? 4 : touchSlop(VARIANT_SIZE[variant])}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        selected === undefined ? { disabled: inactive } : { disabled: inactive, selected }
      }
      style={[styles.button, styles[variant]]}
    >
      <Icon
        name={icon}
        size={variantIconSize(variant, size)}
        color={color ?? DEFAULT_COLORS[variant]}
      />
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
  // Each button picks a plain style entry for its variant instead of a stylesheet variant, which
  // runs native code on each render.
  plain: { minWidth: theme.touchTarget - 4, minHeight: theme.touchTarget - 4 },
  filled: {
    width: VARIANT_SIZE.filled,
    height: VARIANT_SIZE.filled,
    backgroundColor: theme.colors.fillStrong,
  },
  tinted: {
    width: VARIANT_SIZE.tinted,
    height: VARIANT_SIZE.tinted,
    backgroundColor: theme.colors.tintSoft,
    borderWidth: 1,
    borderColor: theme.colors.tintBorder,
  },
  outline: {
    width: VARIANT_SIZE.outline,
    height: VARIANT_SIZE.outline,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    boxShadow: theme.shadows.card,
  },
  primary: {
    width: VARIANT_SIZE.primary,
    height: VARIANT_SIZE.primary,
    backgroundColor: theme.colors.tintFill,
    boxShadow: theme.shadows.primary,
  },
}));
