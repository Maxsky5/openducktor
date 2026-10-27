import type { KanbanColumnId } from "@openducktor/workflows";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { SkeletonFrame } from "@/ui/placeholders";
import { BoardColumnPlaceholder } from "./board-column-list";
import type { BoardColumn } from "./board-columns";
import { BoardLaneSwitcher } from "./board-lane-switcher";

/**
 * The board for a first load, in the layout of the loaded board. The lanes are known before their
 * tasks, so the phone shows the real lane switcher with placeholders in place of the counts, and
 * placeholder cards on the color of the shown lane.
 */
export function BoardSkeleton({
  columns,
  selectedColumn,
  onSelectColumn,
  toolbar,
}: {
  columns: readonly BoardColumn[];
  selectedColumn: KanbanColumnId | null;
  onSelectColumn: (id: KanbanColumnId) => void;
  /** The board filter control at the end of the lane title row. */
  toolbar: ReactNode;
}): ReactElement {
  // The pager has no width yet, so the switcher shows the selected lane at rest.
  const scrollX = useSharedValue(0);
  const pageWidth = useSharedValue(0);
  const selectedIndex = Math.max(
    0,
    columns.findIndex((column) => column.id === selectedColumn),
  );
  const shown = columns[selectedIndex];
  return (
    <View style={styles.root}>
      <BoardLaneSwitcher
        loading
        columns={columns}
        selectedIndex={selectedIndex}
        scrollX={scrollX}
        pageWidth={pageWidth}
        onSelect={onSelectColumn}
        trailing={toolbar}
      />
      <View style={[styles.root, shown ? styles.wash(shown.id) : null]}>
        <SkeletonFrame label="Loading tasks">
          <BoardColumnPlaceholder />
        </SkeletonFrame>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  // The lane color behind the cards, as the pager paints the shown lane.
  wash: (id: KanbanColumnId) => ({ backgroundColor: theme.lanes[id].wash }),
}));
