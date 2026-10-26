import {
  Children,
  isValidElement,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Toggle } from "./fields";
import { haptics } from "./haptics";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { Touchable } from "./touchable";

/**
 * The desktop settings section (`settings-*-section.tsx`): a semibold title, one line of context
 * in the muted color, then its cards.
 */
export function SettingsSection({
  title,
  description,
  trailing,
  children,
}: PropsWithChildren<{
  title: string;
  description?: string | undefined;
  trailing?: ReactNode;
}>): ReactElement {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.flex}>
          <Text variant="headline" accessibilityRole="header">
            {title}
          </Text>
          {description ? (
            <Text variant="subhead" tone="tertiary">
              {description}
            </Text>
          ) : null}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/**
 * The desktop card with `divide-y`: a white surface with an outline. A hairline separates its
 * rows, which are elements. `Children.toArray` gives each row a key. `radius` follows the desktop
 * class: `md` for settings, `xl` for diagnostics.
 */
export function DividedCard({
  radius = "md",
  children,
}: PropsWithChildren<{ radius?: "md" | "xl" }>): ReactElement {
  styles.useVariants({ radius });
  return (
    <View style={styles.card}>
      {Children.toArray(children)
        .filter(isValidElement)
        .map((row, index) => (
          <View key={row.key} style={index > 0 && styles.divider}>
            {row}
          </View>
        ))}
    </View>
  );
}

/**
 * The desktop row icon tile (`size-9 rounded-lg border bg-muted/50`). `selected` uses the desktop
 * selection colors, as the current host. `color` tints the icon, as a status.
 */
export function SettingsIconTile({
  icon,
  color,
  selected = false,
  muted = false,
  children,
}: {
  icon?: IconName | undefined;
  color?: string | undefined;
  selected?: boolean | undefined;
  /** Dims the tile of a disabled item, as a runtime that is off. */
  muted?: boolean | undefined;
  /** A custom mark instead of `icon`, such as a runtime brand mark. */
  children?: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={[styles.tile, selected && styles.tileSelected, muted && styles.tileMuted]}>
      {icon ? (
        <Icon
          name={icon}
          size={18}
          colorValue={
            color ?? (selected ? theme.desktop.selectedAccent : theme.desktop.mutedForeground)
          }
        />
      ) : (
        children
      )}
    </View>
  );
}

/**
 * A desktop settings row: a medium title, a muted description, and a control at the trailing
 * edge. `children` show under the text, as a control that needs the full width. A row with
 * `onPress` opens a screen and shows a chevron.
 */
export function SettingsRow({
  title,
  description,
  detail,
  leading,
  trailing,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  children,
}: PropsWithChildren<{
  title: string;
  description?: string | null | undefined;
  /** Extra lines under the description, such as an address in a monospace font. */
  detail?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
}>): ReactElement {
  const content = (
    <>
      <View style={styles.rowLine}>
        {leading}
        <View style={styles.rowText}>
          <Text weight="medium" numberOfLines={1}>
            {title}
          </Text>
          {description ? (
            <Text variant="subhead" tone="tertiary">
              {description}
            </Text>
          ) : null}
          {detail}
        </View>
        {trailing}
        {onPress ? <Icon name="chevron-right" size={16} color="tertiaryLabel" /> : null}
      </View>
      {children}
    </>
  );
  if (!onPress) {
    return (
      <View
        style={styles.row}
        accessible={children === undefined}
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </View>
    );
  }
  return (
    <Touchable
      feedback="highlight"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      style={styles.row}
    >
      {content}
    </Touchable>
  );
}

/**
 * A desktop settings row with a switch (`ChatSettingSwitchRow`). The whole row toggles it, with a
 * selection haptic.
 */
export function SettingsSwitchRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}): ReactElement {
  return (
    <Touchable
      feedback="highlight"
      onPress={() => {
        haptics.selection();
        onValueChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ checked: value }}
      style={styles.row}
    >
      <View style={styles.rowLine}>
        <View style={styles.rowText}>
          <Text weight="medium">{title}</Text>
          <Text variant="subhead" tone="tertiary">
            {description}
          </Text>
        </View>
        <Toggle value={value} />
      </View>
    </Touchable>
  );
}

/** The app name and version under the last section, as the desktop host connection page. */
export function AppVersionFooter({ version }: { version: string }): ReactElement {
  return (
    <Text
      variant="footnote"
      tone="tertiary"
      style={styles.footer}
      accessibilityLabel={`OpenDucktor version ${version}`}
    >
      {`OpenDucktor ${version}`}
    </Text>
  );
}

const TILE = 36;

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, gap: theme.space.xxs },
  section: { gap: theme.space.md },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.space.md,
    paddingHorizontal: theme.space.xs,
  },
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    borderCurve: "continuous",
    boxShadow: theme.shadows.card,
    variants: {
      radius: {
        md: { borderRadius: theme.radius.md },
        xl: { borderRadius: theme.radius.xl },
      },
    },
  },
  divider: { borderTopWidth: 1, borderTopColor: theme.desktop.border },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.nestedFill,
    alignItems: "center",
    justifyContent: "center",
  },
  tileSelected: {
    borderColor: withAlpha(theme.desktop.selectedAccent, 0.4),
    backgroundColor: theme.desktop.selectedSurface,
  },
  tileMuted: { opacity: 0.6 },
  row: {
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: 14,
    backgroundColor: theme.desktop.card,
  },
  rowLine: {
    minHeight: TILE,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
  },
  rowText: { flex: 1, minWidth: 0, gap: theme.space.xxs },
  footer: { textAlign: "center", paddingTop: theme.space.sm },
}));
