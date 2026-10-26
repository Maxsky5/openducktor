import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { CollapseChevron } from "@/ui/collapse-chevron";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/**
 * The header of a task details card, as the desktop card headers: an icon and an uppercase muted
 * title, then an optional summary such as a count, and the chevron. A press opens or closes the
 * card.
 */
function DetailsCardHeader({
  title,
  icon,
  trailing,
  collapsed,
  onToggle,
}: {
  title: string;
  icon: IconName;
  trailing?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="highlight"
      radius={theme.radius.lg}
      onPress={() => {
        haptics.selection();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ expanded: !collapsed }}
      style={[styles.header, collapsed && styles.closedHeader]}
    >
      <Icon name={icon} size={14} colorValue={theme.desktop.mutedForeground} />
      <Text variant="footnote" weight="semibold" overline numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {trailing}
      <CollapseChevron collapsed={collapsed} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
}

/**
 * A card of the task details, as the desktop details cards: a white surface with an outline and
 * a soft shadow, an uppercase header, and its content. The header opens and closes the card, and
 * a closed card shows only its header.
 */
export function DetailsCard({
  title,
  icon,
  trailing,
  collapsed,
  onToggle,
  children,
}: PropsWithChildren<{
  title: string;
  icon: IconName;
  trailing?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}>): ReactElement {
  return (
    <View style={styles.outer}>
      <View style={styles.card}>
        <DetailsCardHeader
          title={title}
          icon={icon}
          trailing={trailing}
          collapsed={collapsed}
          onToggle={onToggle}
        />
        {collapsed ? null : <View style={styles.body}>{children}</View>}
      </View>
    </View>
  );
}

/** The count at the end of a card header, as the desktop summary capsule. */
export function DetailsCount({ value }: { value: string }): ReactElement {
  return (
    <View style={styles.count}>
      <Text variant="caption2" weight="medium" tabular style={styles.countText}>
        {value}
      </Text>
    </View>
  );
}

/** An empty state in a card, as the desktop dashed muted box ("No subtasks yet."). */
export function DetailsNote({
  text,
  leading,
}: {
  text: string;
  leading?: ReactNode;
}): ReactElement {
  return (
    <View style={styles.note} accessibilityLiveRegion="polite">
      {leading}
      <Text variant="subhead" style={styles.noteText}>
        {text}
      </Text>
    </View>
  );
}

/**
 * An item of a card, as the desktop muted list items: a rounded muted box with a leading mark,
 * the content, and an optional trailing value. A press opens the item.
 */
export function DetailsItem({
  leading,
  trailing,
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  chevron = onPress !== undefined,
}: PropsWithChildren<{
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  accessibilityLabel: string;
  accessibilityHint?: string | undefined;
  chevron?: boolean;
}>): ReactElement {
  const theme = useAppTheme();
  const content = (
    <>
      {leading}
      <View style={styles.itemBody}>{children}</View>
      {trailing}
      {chevron ? (
        <Icon name="chevron-right" size={15} colorValue={theme.desktop.mutedForeground} />
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.item} accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Touchable
      feedback="highlight"
      onPress={onPress}
      radius={theme.radius.sm}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={styles.item}
    >
      {content}
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  outer: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.md },
  card: {
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  header: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
  },
  // A closed card ends under its header, with the space of its top.
  closedHeader: { paddingBottom: theme.space.md },
  title: { flex: 1, color: theme.desktop.mutedForeground },
  body: { gap: theme.space.sm, paddingHorizontal: theme.space.md, paddingBottom: theme.space.md },
  count: {
    minWidth: 24,
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  countText: { color: theme.desktop.mutedForeground },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  noteText: { flex: 1, color: theme.desktop.mutedForeground },
  item: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  itemBody: { flex: 1, minWidth: 0, gap: 3 },
}));
