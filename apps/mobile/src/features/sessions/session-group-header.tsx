import type { SessionNavigationGroupId } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { CollapseChevron } from "@/ui/collapse-chevron";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import type { DesktopColorName } from "./session-list-model";

/** The desktop group icons and colors (`SESSION_GROUP_ICON_CLASSES`, `SESSION_GROUP_COUNT_CLASSES`). */
const GROUP_STYLE = {
  needs_you: {
    icon: "circle-alert",
    iconColor: "warningAccent",
    countBackground: "warningSurface",
    countColor: "warningMuted",
  },
  running: {
    icon: "activity",
    iconColor: "infoAccent",
    countBackground: "infoSurface",
    countColor: "infoMuted",
  },
  recent: {
    icon: "clock",
    iconColor: "sidebarMutedForeground",
    countBackground: "muted",
    countColor: "sidebarForeground",
  },
} as const satisfies Record<
  SessionNavigationGroupId,
  {
    icon: IconName;
    iconColor: DesktopColorName;
    countBackground: DesktopColorName;
    countColor: DesktopColorName;
  }
>;

/**
 * The header of a session group, as the desktop sidebar: a muted bar with the group icon, the
 * name, the count, and a chevron. A tap folds or unfolds the group.
 */
export const SessionGroupHeader = memo(function SessionGroupHeader({
  groupId,
  label,
  count,
  collapsed,
  onToggle,
}: {
  groupId: SessionNavigationGroupId;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: (groupId: SessionNavigationGroupId) => void;
}): ReactElement {
  const theme = useAppTheme();
  const group = GROUP_STYLE[groupId];
  return (
    <View style={styles.cell}>
      <Touchable
        feedback="highlight"
        radius={theme.radius.md}
        onPress={() => {
          haptics.selection();
          onToggle(groupId);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${count} ${count === 1 ? "session" : "sessions"}`}
        accessibilityState={{ expanded: !collapsed }}
        style={styles.bar}
      >
        <Icon name={group.icon} size={16} colorValue={theme.desktop[group.iconColor]} />
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.count, { backgroundColor: theme.desktop[group.countBackground] }]}>
          <Text tabular style={[styles.countText, { color: theme.desktop[group.countColor] }]}>
            {count}
          </Text>
        </View>
        <CollapseChevron collapsed={collapsed} colorValue={theme.desktop.sidebarMutedForeground} />
      </Touchable>
    </View>
  );
});

/**
 * A group header for the first load: the icon and the name of the group, as the real header,
 * with a placeholder in place of the count.
 */
export function SessionGroupHeaderPlaceholder({
  groupId,
  label,
}: {
  groupId: SessionNavigationGroupId;
  label: string;
}): ReactElement {
  const theme = useAppTheme();
  const group = GROUP_STYLE[groupId];
  return (
    <View style={styles.cell}>
      <View style={styles.bar}>
        <Icon name={group.icon} size={16} colorValue={theme.desktop[group.iconColor]} />
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.count, styles.countPlaceholder]} />
        <Icon name="chevron-down" size={14} colorValue={theme.desktop.sidebarMutedForeground} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  cell: {
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.xs,
  },
  bar: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    backgroundColor: theme.colors.chipFill,
  },
  label: {
    ...theme.type.subhead,
    fontFamily: theme.fonts.sans.semibold,
    fontWeight: "600",
    flex: 1,
    color: theme.desktop.sidebarForeground,
  },
  // The pill grows with the text size, so a large font does not clip the count.
  count: {
    minWidth: 24,
    minHeight: 20,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  countPlaceholder: { backgroundColor: theme.colors.fill },
  countText: {
    ...theme.type.caption1,
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
  },
}));
