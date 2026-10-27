import { type BuiltinTaskCard as TaskCardData } from "@openducktor/workflows";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { Fragment, memo, type ReactElement, useCallback } from "react";
import { type DimensionValue, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardColumn } from "./board-columns";
import { useTabBarSpace } from "@/navigation/tab-bar/tab-bar-metrics";
import { ListRefreshControl } from "@/ui/refresh-control";
import { useCompactHeight } from "@/ui/use-wide-layout";
import { LaneEmpty } from "./board-lane";
import { LaneShownContext } from "./lane-shown-context";
import { TaskCard, type TaskCardHandlers, TaskCardPlaceholder } from "./task-card";
import type { BoardSessionLookup } from "./use-task-board";

export type BoardColumnListProps = TaskCardHandlers & {
  column: BoardColumn;
  /** False for a lane that the phone pager does not show. */
  active: boolean;
  sessions: BoardSessionLookup;
  selectedTaskId: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** Opens New Task from an empty Backlog. Null when the workspace cannot create tasks now. */
  onNewTask: (() => void) | null;
};

const keyOf = (task: TaskCardData): string => task.id;
const typeOf = (): string => "task";

function Separator(): ReactElement {
  return <View style={styles.separator} />;
}

/**
 * The tasks of one lane as a dense vertical list on the lane color, as the cards of a desktop
 * lane. A low window, such as a phone in landscape, shows the cards in two columns, so more of
 * them fit its height. Only the visible cards render.
 */
export const BoardColumnList = memo(function BoardColumnList({
  column,
  active,
  sessions,
  selectedTaskId,
  isRefreshing,
  onRefresh,
  onNewTask,
  onOpenDetails,
  onAction,
  onOpenSession,
}: BoardColumnListProps): ReactElement {
  const tabBarSpace = useTabBarSpace();
  const grid = useCompactHeight();
  const renderItem = useCallback<ListRenderItem<TaskCardData>>(
    ({ item }) => {
      const card = (
        <TaskCard
          task={item}
          taskSessions={sessions.sessionsOf(item.id)}
          historicalSessions={sessions.historyOf(item.id)}
          activeSessionRole={sessions.activeContextOf(item.id)?.role}
          taskActivityState={sessions.activityOf(item.id)}
          selected={item.id === selectedTaskId}
          onOpenDetails={onOpenDetails}
          onAction={onAction}
          onOpenSession={onOpenSession}
        />
      );
      return grid ? <View style={styles.gridCell}>{card}</View> : card;
    },
    [grid, onAction, onOpenDetails, onOpenSession, selectedTaskId, sessions],
  );
  return (
    <LaneShownContext value={active}>
      <FlashList
        // A rotation changes the column count, so the list lays out again from the start.
        key={grid ? "grid" : "list"}
        data={column.tasks}
        renderItem={renderItem}
        keyExtractor={keyOf}
        getItemType={typeOf}
        extraData={selectedTaskId}
        numColumns={grid ? 2 : 1}
        masonry={grid}
        ItemSeparatorComponent={grid ? undefined : Separator}
        contentContainerStyle={[
          grid ? styles.gridContent : styles.content,
          { paddingBottom: tabBarSpace },
        ]}
        accessibilityLabel={`${column.title} tasks`}
        refreshControl={<ListRefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<LaneEmpty column={column} onNewTask={onNewTask} />}
      />
    </LaneShownContext>
  );
});

/** Title widths that change from card to card, as real task titles do. */
const PLACEHOLDER_CARDS: readonly { id: string; title: DimensionValue }[] = [
  { id: "card-1", title: "82%" },
  { id: "card-2", title: "64%" },
  { id: "card-3", title: "76%" },
  { id: "card-4", title: "58%" },
  { id: "card-5", title: "70%" },
];

/** The cards of a lane for a first load, with the spacing and the columns of the lane list. */
export function BoardColumnPlaceholder(): ReactElement {
  const grid = useCompactHeight();
  if (grid) {
    return (
      <View style={[styles.gridContent, styles.gridPlaceholder]}>
        {PLACEHOLDER_CARDS.slice(0, 4).map((card) => (
          <View key={card.id} style={styles.gridPlaceholderCell}>
            <TaskCardPlaceholder titleWidth={card.title} />
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.content}>
      {PLACEHOLDER_CARDS.map((card, index) => (
        <Fragment key={card.id}>
          {index > 0 ? <Separator /> : null}
          <TaskCardPlaceholder titleWidth={card.title} />
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.huge,
  },
  separator: { height: theme.space.sm },
  // Each card cell gives half of the gap between columns, so the outer edges keep the list inset.
  gridContent: {
    paddingHorizontal: theme.space.md - theme.space.xs,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.huge,
  },
  gridCell: { paddingHorizontal: theme.space.xs, paddingBottom: theme.space.sm },
  gridPlaceholder: { flexDirection: "row", flexWrap: "wrap" },
  gridPlaceholderCell: {
    width: "50%",
    paddingHorizontal: theme.space.xs,
    paddingBottom: theme.space.sm,
  },
}));
