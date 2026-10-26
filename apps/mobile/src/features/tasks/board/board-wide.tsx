import { memo, type ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { SkeletonFrame } from "@/ui/placeholders";
import { Text } from "@/ui/text";
import {
  BoardColumnList,
  type BoardColumnListProps,
  BoardColumnPlaceholder,
} from "./board-column-list";
import { type BoardColumn, columnChoiceLabel } from "./board-columns";
import { LaneCount, LaneCountPlaceholder } from "./board-lane";

const COLUMN_WIDTH = 320;
const COLLAPSED_WIDTH = 56;

/** The desktop column header: the lane accent bar, the uppercase name, and the task count. */
const LaneHeader = memo(function LaneHeader({
  column,
  loading,
}: {
  column: BoardColumn;
  loading: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const lane = theme.lanes[column.id];
  return (
    <View
      style={[styles.header, { borderBottomColor: lane.border }]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={columnChoiceLabel(column)}
    >
      <View style={[styles.accentBar, { backgroundColor: lane.accent }]} />
      <View style={styles.headerRow}>
        <Text variant="footnote" weight="semibold" overline numberOfLines={1} style={styles.title}>
          {column.title}
        </Text>
        {loading ? (
          <LaneCountPlaceholder columnId={column.id} />
        ) : (
          <LaneCount columnId={column.id} count={column.tasks.length} long />
        )}
      </View>
    </View>
  );
});

/** An empty column that the host Kanban setting collapses: a narrow lane with its name. */
const CollapsedLane = memo(function CollapsedLane({
  column,
}: {
  column: BoardColumn;
}): ReactElement {
  const theme = useAppTheme();
  const lane = theme.lanes[column.id];
  return (
    <View
      style={[styles.collapsed, { backgroundColor: lane.wash, borderColor: lane.border }]}
      accessible
      accessibilityLabel={`${columnChoiceLabel(column)}. ${column.emptyMessage ?? ""}`}
    >
      <View style={[styles.collapsedDot, { backgroundColor: lane.accent }]} />
      <LaneCount columnId={column.id} count={0} />
      <Text
        variant="footnote"
        weight="semibold"
        overline
        style={[styles.collapsedTitle, { color: lane.text }]}
        numberOfLines={1}
      >
        {column.title}
      </Text>
    </View>
  );
});

/**
 * Tablets and wide landscape show the columns side by side, as the desktop board: each lane has
 * its color wash, outline, and header. The board scrolls horizontally.
 */
export function BoardWide({
  columns,
  ...listProps
}: Omit<BoardColumnListProps, "column" | "active"> & {
  columns: readonly BoardColumn[];
}): ReactElement {
  const theme = useAppTheme();
  return (
    <ScrollView horizontal contentContainerStyle={styles.board} showsHorizontalScrollIndicator>
      {/* The board has one column for each lane, and each lane is a virtualized list. */}
      {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
      {columns.map((column) => {
        if (column.collapsed) return <CollapsedLane key={column.id} column={column} />;
        const lane = theme.lanes[column.id];
        return (
          <View
            key={column.id}
            style={[styles.column, { backgroundColor: lane.wash, borderColor: lane.border }]}
          >
            <LaneHeader column={column} loading={false} />
            <BoardColumnList column={column} active {...listProps} />
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * The wide board for a first load: each lane in its colors with its header and placeholder cards.
 * The task counts are not known yet, so no lane shows collapsed.
 */
export function BoardWidePlaceholder({
  columns,
}: {
  columns: readonly BoardColumn[];
}): ReactElement {
  const theme = useAppTheme();
  return (
    <SkeletonFrame label="Loading tasks">
      <ScrollView horizontal contentContainerStyle={styles.board}>
        {/* The board has one column for each of its lanes, as the loaded board. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {columns.map((column) => {
          const lane = theme.lanes[column.id];
          return (
            <View
              key={column.id}
              style={[styles.column, { backgroundColor: lane.wash, borderColor: lane.border }]}
            >
              <LaneHeader column={column} loading />
              <BoardColumnPlaceholder />
            </View>
          );
        })}
      </ScrollView>
    </SkeletonFrame>
  );
}

const styles = StyleSheet.create((theme) => ({
  board: {
    padding: theme.space.md,
    gap: theme.space.md,
  },
  column: {
    width: COLUMN_WIDTH,
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: theme.radius.xxl,
    borderCurve: "continuous",
  },
  header: {
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.md,
    borderBottomWidth: theme.hairline,
  },
  accentBar: { width: 56, height: 6, borderRadius: 3 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  title: { flex: 1 },
  collapsed: {
    width: COLLAPSED_WIDTH,
    alignItems: "center",
    gap: theme.space.sm,
    paddingVertical: theme.space.lg,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
  },
  collapsedDot: { width: 18, height: 6, borderRadius: 3 },
  collapsedTitle: {
    transform: [{ rotate: "90deg" }],
    width: 200,
    textAlign: "center",
    marginTop: 92,
  },
}));
