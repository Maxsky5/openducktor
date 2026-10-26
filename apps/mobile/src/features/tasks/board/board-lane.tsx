import type { KanbanColumnId } from "@openducktor/core";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { TextPlaceholder } from "@/ui/placeholders";
import { Text } from "@/ui/text";
import type { BoardColumn } from "./board-columns";

const laneCountLabel = (count: number): string => (count === 1 ? "1 task" : `${count} tasks`);

/** The task count of a lane in a capsule of the lane colors, as the desktop column headers. */
export const LaneCount = memo(function LaneCount({
  columnId,
  count,
  long = false,
  maxFontSizeMultiplier,
}: {
  columnId: KanbanColumnId;
  count: number;
  /** "3 tasks" instead of "3", for a column header with room for it. */
  long?: boolean;
  /** Caps the text size in a row of fixed height. */
  maxFontSizeMultiplier?: number;
}): ReactElement {
  const theme = useAppTheme();
  const lane = theme.lanes[columnId];
  return (
    <View style={[styles.count, { borderColor: lane.border }]}>
      <Text
        variant="caption2"
        tabular
        numberOfLines={1}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={{ color: lane.text }}
      >
        {long ? laneCountLabel(count) : count}
      </Text>
    </View>
  );
});

/** A lane count for a first load: the capsule of the lane colors with a bar in place of "3 tasks". */
export function LaneCountPlaceholder({
  columnId,
  maxFontSizeMultiplier,
}: {
  columnId: KanbanColumnId;
  maxFontSizeMultiplier?: number;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={[styles.count, { borderColor: theme.lanes[columnId].border }]}>
      <TextPlaceholder variant="caption2" width={38} maxFontScale={maxFontSizeMultiplier} />
    </View>
  );
}

/**
 * An empty lane, as the desktop: a dashed box in the lane colors with the inbox icon and "No tasks
 * in this lane." It adds why the lane is empty when the filters or the Done setting explain it.
 * Backlog offers New Task, so an empty board still leads to the next step.
 */
export const LaneEmpty = memo(function LaneEmpty({
  column,
  onNewTask,
}: {
  column: Pick<BoardColumn, "id" | "title" | "emptyMessage">;
  /** Shows New Task in Backlog. Null when the workspace cannot create tasks now. */
  onNewTask: (() => void) | null;
}): ReactElement {
  const theme = useAppTheme();
  const lane = theme.lanes[column.id];
  return (
    <View style={[styles.empty, { borderColor: lane.border }]}>
      <View style={styles.emptyIcon}>
        <Icon name="inbox" size={16} colorValue={lane.text} />
      </View>
      <Text variant="footnote" weight="medium" style={[styles.center, { color: lane.text }]}>
        No tasks in this lane.
      </Text>
      {column.emptyMessage ? (
        <Text variant="footnote" style={[styles.center, styles.message]}>
          {column.emptyMessage}
        </Text>
      ) : null}
      {column.id === "open" && onNewTask ? (
        <View style={styles.action}>
          <Button label="New Task" icon="plus" size="sm" variant="outline" onPress={onNewTask} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  count: {
    minWidth: 24,
    minHeight: 24,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    backgroundColor: theme.desktop.card,
  },
  empty: {
    minHeight: 112,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.xs,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.lg,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderStyle: "dashed",
    backgroundColor: withAlpha(theme.desktop.card, 0.8),
  },
  emptyIcon: { opacity: 0.7 },
  center: { textAlign: "center", maxWidth: 300 },
  message: { color: theme.desktop.mutedForeground },
  action: { paddingTop: theme.space.sm },
}));
