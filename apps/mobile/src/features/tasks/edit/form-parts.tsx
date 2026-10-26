import { type PropsWithChildren, type ReactElement, type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  type StyleProp,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandBlocked } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import { Toggle } from "@/ui/fields";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/**
 * A form field as the desktop task dialog: the label above its control, as the desktop `Label`
 * (`text-sm font-medium text-foreground`), and an optional note under the control.
 */
export function FormField({
  label,
  required = false,
  trailing,
  note,
  children,
}: PropsWithChildren<{
  label: string;
  /** Adds the desktop asterisk of a required field. */
  required?: boolean;
  /** A control at the trailing edge of the label row, such as a mode switch. */
  trailing?: ReactNode;
  note?: string | null | undefined;
}>): ReactElement {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text variant="callout" weight="medium" style={styles.grow} numberOfLines={1}>
          {required ? `${label} *` : label}
        </Text>
        {trailing}
      </View>
      {children}
      {note ? (
        <Text variant="footnote" tone="tertiary">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** The desktop field chrome: a card surface, the input outline, a medium radius, a soft shadow. */
export function FieldBox({
  children,
  focused = false,
  style,
}: PropsWithChildren<{ focused?: boolean; style?: StyleProp<ViewStyle> }>): ReactElement {
  styles.useVariants({ focused });
  return <View style={[styles.box, style]}>{children}</View>;
}

/** A text input in the desktop field chrome. The outline takes the ring color while it has focus. */
export function FieldInput({
  editable = true,
  mono = false,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { mono?: boolean }): ReactElement {
  const theme = useAppTheme();
  const [focused, setFocused] = useState(false);
  styles.useVariants({ focused, mono });
  return (
    <TextInput
      editable={editable}
      placeholderTextColor={theme.desktop.mutedForeground}
      selectionColor={theme.colors.selection}
      selectionHandleColor={theme.colors.tint}
      cursorColor={theme.colors.tint}
      accessibilityState={{ disabled: !editable }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[styles.box, styles.input, style]}
      {...props}
    />
  );
}

/**
 * A small text button with a Lucide icon, as the desktop `ghost` and `outline` buttons of a
 * toolbar, such as Insert image. `danger` is the desktop `destructiveGhost` variant.
 */
export function ToolbarButton({
  label,
  icon,
  onPress,
  variant = "ghost",
  disabled = false,
  loading = false,
  command = false,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName | undefined;
  onPress: () => void;
  variant?: "ghost" | "outline" | "danger";
  disabled?: boolean;
  /** Shows progress instead of the icon while the action runs. */
  loading?: boolean;
  /** True when the press sends a host command. The button follows the connection command gate. */
  command?: boolean;
  accessibilityLabel?: string | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const blockedByConnection = useCommandBlocked(command, label);
  const inactive = disabled || loading || blockedByConnection;
  styles.useVariants({ variant });
  const color = variant === "danger" ? theme.desktop.destructiveMuted : theme.desktop.foreground;
  let leading: ReactNode = null;
  if (loading) leading = <ActivityIndicator size="small" color={color} />;
  else if (icon) leading = <Icon name={icon} size={15} colorValue={color} />;
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      disabled={inactive}
      dimWhenDisabled={!loading}
      radius={theme.radius.sm}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={
        blockedByConnection ? "Available when the host connection is live." : undefined
      }
      accessibilityState={{ busy: loading }}
      style={styles.toolbarButton}
    >
      {leading}
      <Text variant="subhead" weight="medium" numberOfLines={1} style={{ color }}>
        {label}
      </Text>
    </Touchable>
  );
}

/**
 * A switch with its sentence in one outlined box, as the desktop switch and its label. The whole
 * box toggles the switch.
 */
export function SwitchBox({
  label,
  text,
  value,
  onValueChange,
  disabled = false,
}: {
  /** The accessible name, such as the field label. */
  label: string;
  /** The sentence next to the switch. */
  text: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="highlight"
      onPress={() => {
        haptics.selection();
        onValueChange(!value);
      }}
      disabled={disabled}
      radius={theme.radius.md}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={text}
      accessibilityState={{ checked: value }}
      style={[styles.box, styles.switchBox]}
    >
      <Text variant="callout" weight="semibold" style={styles.grow}>
        {text}
      </Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Toggle value={value} disabled={disabled} />
      </View>
    </Touchable>
  );
}

/**
 * Two or three views of a text as the desktop inline view switch: a quiet track with the
 * selected view on a white segment. Each option has an icon and a short name.
 */
export function ViewSwitch<Value extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly { value: Value; label: string; icon: IconName }[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.switchTrack} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        const color = selected ? theme.desktop.foreground : theme.desktop.mutedForeground;
        return (
          <Touchable
            key={option.value}
            feedback="opacity"
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            disabled={disabled}
            radius={theme.radius.sm}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            style={[styles.switchItem, selected && styles.switchItemSelected]}
          >
            <Icon name={option.icon} size={14} colorValue={color} />
            <Text variant="footnote" weight={selected ? "semibold" : "medium"} style={{ color }}>
              {option.label}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.space.sm },
  labelRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 20 },
  grow: { flex: 1 },
  box: {
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
    variants: {
      focused: {
        true: { borderColor: theme.desktop.ring },
        false: { borderColor: theme.desktop.input },
      },
    },
  },
  input: {
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
    paddingVertical: 11,
    color: theme.desktop.foreground,
    ...theme.type.body,
    variants: {
      mono: {
        true: {
          fontFamily: theme.fonts.mono.regular,
          fontWeight: "400",
          fontSize: 13,
          lineHeight: 24,
        },
        false: {},
      },
    },
  },
  toolbarButton: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    variants: {
      variant: {
        ghost: { borderColor: "transparent" },
        outline: {
          borderColor: theme.desktop.input,
          backgroundColor: theme.desktop.card,
          boxShadow: theme.shadows.card,
        },
        danger: { borderColor: "transparent" },
      },
    },
  },
  switchBox: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderColor: theme.desktop.input,
  },
  switchTrack: {
    flexDirection: "row",
    alignSelf: "flex-start",
    padding: 2,
    gap: 2,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.insetFill,
  },
  switchItem: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
  },
  switchItemSelected: {
    backgroundColor: theme.desktop.secondary,
  },
}));
