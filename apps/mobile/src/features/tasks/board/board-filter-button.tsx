import type { KanbanBoardFilter } from "@openducktor/frontend-core/tasks/board/kanban-board-filter";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { verticalTouchSlop } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { filtersControlLabel, selectedFilterCount } from "./board-filter-controls";

const BUTTON_HEIGHT = 28;
const BUTTON_SLOP = { ...verticalTouchSlop(BUTTON_HEIGHT), left: 4, right: 4 };

/**
 * The board filter control, after the desktop filter menu buttons: an outlined button with the
 * filter icon. It is dashed without a selection, and shows the count of selected values after a
 * divider, as the desktop selection badge.
 */
export const BoardFilterButton = memo(function BoardFilterButton({
  filter,
  onPress,
}: {
  filter: KanbanBoardFilter;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const count = selectedFilterCount(filter);
  styles.useVariants({ active: count > 0 });
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      radius={theme.radius.sm}
      hitSlop={BUTTON_SLOP}
      accessibilityRole="button"
      accessibilityLabel={filtersControlLabel(filter)}
      accessibilityHint="Filters the tasks by label, type, and priority."
      style={styles.button}
    >
      <Icon name="filter" size={14} colorValue={theme.desktop.mutedForeground} />
      <Text variant="footnote" weight="medium" style={styles.label}>
        Filters
      </Text>
      {count > 0 ? (
        <>
          <View style={styles.divider} />
          <View style={styles.badge}>
            <Text variant="footnote" tabular style={styles.label}>
              {count}
            </Text>
          </View>
        </>
      ) : null}
    </Touchable>
  );
});

const styles = StyleSheet.create((theme) => ({
  button: {
    minHeight: BUTTON_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
    variants: {
      active: {
        true: { borderStyle: "solid", boxShadow: theme.shadows.card },
        false: { borderStyle: "dashed" },
      },
    },
  },
  label: { color: theme.desktop.foreground },
  divider: { width: 1, height: 14, backgroundColor: theme.desktop.border },
  badge: {
    minWidth: 18,
    alignItems: "center",
    paddingHorizontal: 5,
    borderRadius: 4,
    backgroundColor: theme.desktop.secondary,
  },
}));
