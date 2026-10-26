import type { KanbanColumnId } from "@openducktor/core";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { haptics } from "@/ui/haptics";
import {
  BoardColumnList,
  type BoardColumnListProps,
  BoardColumnPlaceholder,
} from "./board-column-list";
import type { BoardColumn } from "./board-columns";
import { useMountedLanes } from "./board-lane-mounting";
import { BoardLaneSwitcher } from "./board-lane-switcher";
import { useLaneIds } from "./use-lane-ids";

type BoardPagerProps = Omit<BoardColumnListProps, "column" | "active"> & {
  columns: readonly BoardColumn[];
  selectedId: KanbanColumnId | null;
  onSelect: (id: KanbanColumnId) => void;
  /** The board filter control at the end of the lane title row. */
  toolbar?: ReactNode;
};

/**
 * The phone board: one lane per page under the lane switcher. The board takes the color of the
 * lane that it shows. While a swipe moves between lanes, the board color, the selection pill of
 * the switcher, and the lane title follow the finger on the UI thread. A tap on a lane of the
 * switcher scrolls to its page. The shown lane mounts its list first, and the others follow in
 * idle time (see `useMountedLanes`).
 */
export function BoardPager({
  columns,
  selectedId,
  onSelect,
  toolbar,
  ...listProps
}: BoardPagerProps): ReactElement {
  const theme = useAppTheme();
  const pager = useAnimatedRef<Animated.ScrollView>();
  const selectedIndex = Math.max(
    0,
    columns.findIndex((column) => column.id === selectedId),
  );
  // The phone board spans the window, so its lanes render on the first frame. The layout of the
  // board still sets the width, as after a rotation.
  const windowWidth = useWindowDimensions().width;
  const [width, setWidth] = useState(windowWidth);
  const scrollX = useSharedValue(selectedIndex * windowWidth);
  const pageWidth = useSharedValue(windowWidth);
  // The page that the pager shows, so a swipe does not scroll the pager again.
  const shownIndex = useRef(selectedIndex);
  const mountedLanes = useMountedLanes(columns, selectedIndex);
  const laneIds = useLaneIds(columns);
  const washes = useMemo(() => laneIds.map((id) => theme.lanes[id].wash), [laneIds, theme.lanes]);

  useEffect(() => {
    if (width === 0 || shownIndex.current === selectedIndex) return;
    shownIndex.current = selectedIndex;
    pager.current?.scrollTo({ x: selectedIndex * width, animated: true });
  }, [pager, selectedIndex, width]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.set(event.contentOffset.x);
  });

  const boardColor = useAnimatedStyle(() => {
    const page = pageWidth.get();
    if (washes.length < 2 || page === 0) return { backgroundColor: washes[0] ?? "transparent" };
    return {
      backgroundColor: interpolateColor(
        scrollX.get() / page,
        washes.map((_, index) => index),
        washes,
      ),
    };
  });

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width === 0) return;
      const index = Math.round(event.nativeEvent.contentOffset.x / width);
      const column = columns[index];
      if (!column) return;
      shownIndex.current = index;
      if (column.id !== selectedId) {
        haptics.selection();
        onSelect(column.id);
      }
    },
    [columns, onSelect, selectedId, width],
  );

  const selectLane = useCallback(
    (id: KanbanColumnId) => {
      if (id !== selectedId) haptics.selection();
      onSelect(id);
    },
    [onSelect, selectedId],
  );

  return (
    <View style={styles.root}>
      <BoardLaneSwitcher
        columns={columns}
        selectedIndex={selectedIndex}
        scrollX={scrollX}
        pageWidth={pageWidth}
        onSelect={selectLane}
        trailing={toolbar}
      />
      <Animated.View
        style={[styles.root, boardColor]}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          setWidth(next);
          pageWidth.set(next);
          scrollX.set(selectedIndex * next);
        }}
      >
        {width > 0 ? (
          <Animated.ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: selectedIndex * width, y: 0 }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onMomentumScrollEnd}
            directionalLockEnabled
          >
            {/* The pager has one page for each lane, and each lane is a virtualized list. */}
            {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
            {columns.map((column, index) => (
              <View key={column.id} style={{ width }}>
                {mountedLanes.has(column.id) ? (
                  <BoardColumnList
                    column={column}
                    active={index === selectedIndex}
                    {...listProps}
                  />
                ) : (
                  <BoardColumnPlaceholder />
                )}
              </View>
            ))}
          </Animated.ScrollView>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
