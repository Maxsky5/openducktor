import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { ActionMenu } from "./action-menu";
import { haptics } from "./haptics";
import { Icon, type IconName } from "./icon";
import { blurFocusedField } from "./keyboard-dismiss";
import { Text } from "./text";
import { useAnnounce } from "./use-announce";
import { Touchable } from "./touchable";

/**
 * The fields of a workflow sheet, as the body of a desktop dialog: one column with the screen
 * padding and the desktop field spacing.
 */
export function FormBody({ children }: PropsWithChildren): ReactElement {
  return <View style={styles.body}>{children}</View>;
}

/** The text under the sheet title, as the desktop dialog description. */
export function FormLead({ text }: { text: string }): ReactElement {
  return (
    <Text variant="callout" style={styles.lead}>
      {text}
    </Text>
  );
}

/** A small uppercase label above a group of choices, as the desktop section labels. */
export function SectionLabel({ text }: { text: string }): ReactElement {
  return (
    <Text variant="caption1" weight="semibold" tone="tertiary" overline accessibilityRole="header">
      {text}
    </Text>
  );
}

/**
 * A labeled field: the desktop label above its control, with an optional note, help, or error
 * under it. `optional` adds the quiet "optional" mark of the desktop labels. `value` names the
 * choice at the end of the label line, for a control that does not show it as text.
 */
export function FormField({
  label,
  optional = false,
  value,
  hint,
  error,
  children,
}: PropsWithChildren<{
  label: string;
  optional?: boolean | undefined;
  value?: string | null | undefined;
  /** Help under the control. */
  hint?: string | null | undefined;
  /** A problem with the value, under the control. */
  error?: string | null | undefined;
}>): ReactElement {
  useAnnounce(error);
  return (
    <View style={styles.field}>
      <View style={styles.labelLine}>
        <Text variant="subhead" weight="medium" tone="secondary" style={styles.grow}>
          {label}
          {optional ? (
            <Text variant="subhead" tone="tertiary">
              {" optional"}
            </Text>
          ) : null}
        </Text>
        {value ? (
          <Text variant="subhead" weight="medium" numberOfLines={1} style={styles.value}>
            {value}
          </Text>
        ) : null}
      </View>
      {children}
      {error ? (
        <Text variant="footnote" weight="medium" tone="red" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {hint ? (
        <Text variant="footnote" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export type SelectTriggerProps = {
  /** The chosen value, or null to show the placeholder. */
  value: string | null;
  placeholder: string;
  /** A line under the value, such as the runtime and provider of a model. */
  detail?: string | null | undefined;
  /** True when `detail` is a path. A long path keeps both ends, so two paths stay apart. */
  detailIsPath?: boolean | undefined;
  /** A mark before the value, such as a runtime brand mark. */
  leading?: ReactNode;
  /** An icon before the value, in the quiet desktop color. */
  icon?: IconName | undefined;
  /** Branch names and IDs use the code font and keep both ends when they are long. */
  mono?: boolean | undefined;
  disabled?: boolean | undefined;
  onPress?: (() => void) | undefined;
  accessibilityLabel: string;
  accessibilityHint?: string | undefined;
};

/**
 * The desktop select trigger: an outlined field with the chosen value and the up-down chevrons.
 * It has the height and outline of a text field, so a form reads as one column of controls. A
 * press blurs the focused field of the form before the picker or the menu opens.
 */
export function SelectTrigger({
  value,
  placeholder,
  detail,
  detailIsPath = false,
  leading,
  icon,
  mono = false,
  disabled = false,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: SelectTriggerProps): ReactElement {
  const shown = value ?? placeholder;
  const press = (): void => {
    blurFocusedField();
    onPress?.();
  };
  return (
    <Touchable
      feedback="highlight"
      radius={12}
      onPress={press}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel}, ${shown}`}
      accessibilityHint={accessibilityHint}
      style={[styles.trigger, disabled && styles.triggerDisabled]}
    >
      {leading ?? (icon ? <Icon name={icon} size={16} color="tertiaryLabel" /> : null)}
      <View style={styles.triggerText}>
        <Text
          variant={mono ? "mono" : "body"}
          tone={value === null ? "quaternary" : "label"}
          numberOfLines={1}
          ellipsizeMode={mono ? "middle" : "tail"}
          style={mono ? styles.monoValue : null}
        >
          {shown}
        </Text>
        {detail ? (
          <Text
            variant="footnote"
            tone="tertiary"
            numberOfLines={1}
            ellipsizeMode={detailIsPath ? "middle" : "tail"}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {disabled ? null : <Icon name="chevron-up-down" size={16} color="tertiaryLabel" />}
    </Touchable>
  );
}

export type MenuChoice = { value: string; label: string; disabled?: boolean | undefined };

/**
 * A select trigger that opens the desktop dropdown menu of short choices, with a check mark on
 * the chosen one. Each new choice ticks a selection haptic.
 */
export function MenuSelect({
  title,
  choices,
  selected,
  placeholder,
  icon,
  disabled = false,
  onSelect,
}: {
  /** The field name, for the menu title and screen readers. */
  title: string;
  choices: readonly MenuChoice[];
  selected: string | null | undefined;
  placeholder: string;
  icon?: IconName | undefined;
  disabled?: boolean | undefined;
  onSelect: (value: string) => void;
}): ReactElement {
  const inactive = disabled || choices.length === 0;
  const label = choices.find((choice) => choice.value === selected)?.label ?? null;
  const trigger = (
    <SelectTrigger
      value={label}
      placeholder={placeholder}
      icon={icon}
      disabled={inactive}
      accessibilityLabel={title}
      accessibilityHint={inactive ? undefined : "Shows the choices."}
    />
  );
  if (inactive) return trigger;
  return (
    <ActionMenu
      title={title}
      fill
      items={choices.map((choice) => ({
        id: choice.value,
        title: choice.label,
        checked: choice.value === selected,
        disabled: choice.disabled,
      }))}
      onSelect={(id) => {
        if (id === selected) return;
        haptics.selection();
        onSelect(id);
      }}
    >
      {trigger}
    </ActionMenu>
  );
}

/**
 * A choice card, as the desktop option cards: a title, a description, and a check on the chosen
 * card. `info` is the sky card of the approval choices; `primary` the violet outline of the new
 * chat location.
 */
export function OptionCard({
  title,
  description,
  icon,
  selected,
  disabled = false,
  variant = "info",
  onPress,
}: {
  title: string;
  description: string;
  icon?: IconName | undefined;
  selected: boolean;
  disabled?: boolean | undefined;
  variant?: "info" | "primary" | undefined;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const info = variant === "info";
  const selectedColors = info
    ? { borderColor: theme.desktop.infoBorder, backgroundColor: theme.desktop.infoSurface }
    : { borderColor: theme.desktop.primary, backgroundColor: theme.desktop.accent };
  return (
    <Touchable
      feedback="scale"
      radius={info ? theme.radius.xl : theme.radius.md}
      disabled={disabled}
      onPress={() => {
        if (selected) return;
        haptics.selection();
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ checked: selected, disabled }}
      style={[styles.card, info ? styles.infoCard : styles.primaryCard, selected && selectedColors]}
    >
      {icon ? <Icon name={icon} size={18} color="label" /> : null}
      <View style={styles.cardText}>
        <Text variant="body" weight={info ? "semibold" : "medium"}>
          {title}
        </Text>
        <Text variant="subhead" tone="tertiary">
          {description}
        </Text>
      </View>
      {info ? (
        <View style={[styles.checkCircle, selected && selectedColors]}>
          {selected ? <Icon name="check" size={14} colorValue={theme.desktop.infoMuted} /> : null}
        </View>
      ) : selected ? (
        <Icon name="check" size={18} color="label" />
      ) : null}
    </Touchable>
  );
}

/** A quiet bordered panel for a group of fields, as the desktop `rounded-2xl border` panels. */
export function FormPanel({
  muted = false,
  children,
}: PropsWithChildren<{ muted?: boolean | undefined }>): ReactElement {
  return <View style={[styles.panel, muted && styles.panelMuted]}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.space.xl,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
  },
  lead: { color: theme.desktop.mutedForeground },
  field: { gap: theme.space.sm },
  labelLine: { flexDirection: "row", alignItems: "baseline", gap: theme.space.sm },
  grow: { flex: 1, minWidth: 0 },
  value: { flexShrink: 1, color: theme.desktop.foreground },
  trigger: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
  },
  triggerDisabled: { backgroundColor: theme.colors.chipFill },
  triggerText: { flex: 1, minWidth: 0, gap: 1 },
  monoValue: { fontSize: 14 },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    borderWidth: 1,
    borderCurve: "continuous",
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  infoCard: { padding: theme.space.lg, borderRadius: theme.radius.xl },
  primaryCard: { padding: theme.space.md, borderRadius: theme.radius.md, alignItems: "center" },
  cardText: { flex: 1, gap: 2 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    gap: theme.space.md,
    padding: theme.space.lg,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  panelMuted: { backgroundColor: theme.colors.insetFill },
}));
