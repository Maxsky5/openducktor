import { laneColors } from "./lane-colors";
import type { KanbanColumnId } from "@openducktor/workflows";
import {
  type ComponentRef,
  memo,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { TextPlaceholder } from "@/ui/placeholders";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { type BoardColumn, columnChoiceLabel } from "./board-columns";
import { LaneCount, LaneCountPlaceholder } from "./board-lane";

/** The inset of the lane cells in the rail, so the selection pill has room for its shadow. */
const RAIL_INSET = 8;
const CELL_HEIGHT = 50;
const MIN_CELL_WIDTH = 96;
/**
 * The largest text scale of the rail counts and the lane titles. The selection pill and the
 * stacked titles need rows of fixed height.
 */
const MAX_TEXT_SCALE = 1.3;
/** The distance that a lane title slides while the pager moves to the next lane. */
const TITLE_SLIDE = 36;

type PagerPosition = {
  /** The horizontal offset of the pager, which follows the finger on the UI thread. */
  scrollX: SharedValue<number>;
  /** The width of one pager page. Zero before the first layout. */
  pageWidth: SharedValue<number>;
};

/** The pager position as a lane index with a fraction, kept inside the lanes on an overscroll. */
const pagerProgress = (
  scrollX: number,
  pageWidth: number,
  fallback: number,
  lastIndex: number,
): number => {
  "worklet";
  if (pageWidth === 0) return fallback;
  return Math.min(Math.max(scrollX / pageWidth, 0), lastIndex);
};

const LaneCell = memo(function LaneCell({
  column,
  selected,
  loading,
  onSelect,
}: {
  column: BoardColumn;
  selected: boolean;
  loading: boolean;
  onSelect: (id: KanbanColumnId) => void;
}): ReactElement {
  const theme = useAppTheme();
  const lane = laneColors(theme, column.tone);
  const count = column.tasks.length;
  return (
    <Touchable
      feedback="scale"
      onPress={() => onSelect(column.id)}
      accessibilityRole="tab"
      accessibilityLabel={columnChoiceLabel(column)}
      accessibilityState={{ selected }}
      hitSlop={{ top: 4, bottom: 4 }}
      containerStyle={styles.cellContainer}
      style={styles.cell}
    >
      {loading ? (
        <TextPlaceholder variant="subhead" width={12} maxFontScale={MAX_TEXT_SCALE} />
      ) : (
        <Text
          variant="subhead"
          weight="semibold"
          tabular
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_TEXT_SCALE}
          style={{ color: count > 0 ? lane.text : theme.desktop.mutedForeground }}
        >
          {count}
        </Text>
      )}
      <View style={[styles.cellBar, { backgroundColor: lane.accent }, count === 0 && styles.dim]} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_TEXT_SCALE}
        style={[styles.cellLabel, selected && styles.cellLabelSelected]}
      >
        {column.shortLabel}
      </Text>
    </Touchable>
  );
});

const LaneTitle = memo(function LaneTitle({
  column,
  index,
  selected,
  loading,
  fallbackIndex,
  lastIndex,
  position,
}: {
  column: BoardColumn;
  index: number;
  selected: boolean;
  loading: boolean;
  fallbackIndex: number;
  lastIndex: number;
  position: PagerPosition;
}): ReactElement {
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();
  const lane = laneColors(theme, column.tone);
  const { scrollX, pageWidth } = position;
  const motionStyle = useAnimatedStyle(() => {
    const progress = pagerProgress(scrollX.get(), pageWidth.get(), fallbackIndex, lastIndex);
    const offset = index - progress;
    return {
      opacity: interpolate(Math.abs(offset), [0, 0.7], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateX: reducedMotion ? 0 : offset * TITLE_SLIDE }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      accessible={selected}
      accessibilityRole="header"
      accessibilityLabel={columnChoiceLabel(column)}
      accessibilityElementsHidden={!selected}
      importantForAccessibility={selected ? "yes" : "no-hide-descendants"}
      style={[styles.title, motionStyle]}
    >
      <View style={[styles.titleBar, { backgroundColor: lane.accent }]} />
      <Text
        variant="subhead"
        weight="semibold"
        overline
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_TEXT_SCALE}
        style={styles.titleText}
      >
        {column.title}
      </Text>
      {loading ? (
        <LaneCountPlaceholder tone={column.tone} maxFontSizeMultiplier={MAX_TEXT_SCALE} />
      ) : (
        <LaneCount
          tone={column.tone}
          count={column.tasks.length}
          long
          maxFontSizeMultiplier={MAX_TEXT_SCALE}
        />
      )}
    </Animated.View>
  );
});

/**
 * The lane switcher of the phone board. The rail scrolls when the lanes need more room: each task
 * count sits over its desktop accent bar. A tap selects a lane. Under the rail, the lane header names the
 * shown lane. The selection pill, its outline color, and the lane title follow the pager offset on
 * the UI thread, so they move with the finger during a swipe. `trailing` holds the board filter
 * control at the end of the title row. While the tasks load, placeholders take the place of the
 * counts.
 */
export const BoardLaneSwitcher = memo(function BoardLaneSwitcher({
  columns,
  selectedIndex,
  scrollX,
  pageWidth,
  onSelect,
  trailing,
  loading = false,
}: PagerPosition & {
  columns: readonly BoardColumn[];
  selectedIndex: number;
  onSelect: (id: KanbanColumnId) => void;
  trailing?: ReactNode;
  /** True while the tasks load, so the lane counts are not known. */
  loading?: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const railScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const contentWidth = Math.max(viewportWidth, columns.length * MIN_CELL_WIDTH + RAIL_INSET * 2);
  const railWidth = useSharedValue(0);
  useEffect(() => {
    if (viewportWidth === 0 || columns.length === 0) return;
    const cellWidth = (contentWidth - RAIL_INSET * 2) / columns.length;
    railScroll.current?.scrollTo({
      x: Math.max(0, RAIL_INSET + (selectedIndex + 0.5) * cellWidth - viewportWidth / 2),
      animated: false,
    });
  }, [columns.length, contentWidth, selectedIndex, viewportWidth]);
  const borders = useMemo(
    () => columns.map((column) => laneColors(theme, column.tone).border),
    [columns, theme],
  );
  const lastIndex = Math.max(columns.length - 1, 0);
  const position = useMemo(() => ({ scrollX, pageWidth }), [pageWidth, scrollX]);

  const pill = useAnimatedStyle(() => {
    const width = railWidth.get();
    const count = borders.length;
    if (width === 0 || count === 0) return { opacity: 0 };
    const cell = (width - RAIL_INSET * 2) / count;
    const progress = pagerProgress(scrollX.get(), pageWidth.get(), selectedIndex, count - 1);
    return {
      opacity: 1,
      width: cell,
      borderColor:
        count < 2
          ? borders[0]
          : interpolateColor(
              progress,
              borders.map((_, index) => index),
              borders,
            ),
      transform: [{ translateX: progress * cell }],
    };
  });

  return (
    <View style={styles.root}>
      <ScrollView
        ref={railScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      >
        <View
          style={[styles.rail, { width: contentWidth }]}
          onLayout={(event) => railWidth.set(event.nativeEvent.layout.width)}
          accessibilityRole="tablist"
          accessibilityLabel="Board lanes"
        >
          <Animated.View pointerEvents="none" style={[styles.pill, pill]} />
          {columns.map((column, index) => (
            <LaneCell
              key={column.id}
              column={column}
              selected={index === selectedIndex}
              loading={loading}
              onSelect={onSelect}
            />
          ))}
        </View>
      </ScrollView>
      <View style={styles.titleRow}>
        <View style={styles.titles}>
          {columns.map((column, index) => (
            <LaneTitle
              key={column.id}
              column={column}
              index={index}
              selected={index === selectedIndex}
              loading={loading}
              fallbackIndex={selectedIndex}
              lastIndex={lastIndex}
              position={position}
            />
          ))}
        </View>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
    </View>
  );
});

const TITLE_HEIGHT = 34;

const styles = StyleSheet.create((theme) => ({
  root: {
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  rail: {
    flexDirection: "row",
    paddingHorizontal: RAIL_INSET,
    paddingTop: 6,
  },
  pill: {
    position: "absolute",
    top: 6,
    left: RAIL_INSET,
    height: CELL_HEIGHT,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.raised,
  },
  cellContainer: { flex: 1 },
  cell: {
    height: CELL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  cellBar: { width: 16, height: 3, borderRadius: 2 },
  cellLabel: {
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    fontSize: 10,
    lineHeight: 13,
    paddingHorizontal: 1,
    color: theme.desktop.mutedForeground,
  },
  cellLabelSelected: { color: theme.desktop.foreground },
  dim: { opacity: 0.35 },
  // The filter button at the end can grow with the text size, and the stacked titles follow it.
  titleRow: { minHeight: TITLE_HEIGHT + 4, flexDirection: "row", alignItems: "center" },
  titles: { flex: 1, alignSelf: "stretch", overflow: "hidden" },
  trailing: { paddingRight: theme.layout.screenPadding },
  title: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
  },
  titleBar: { width: 14, height: 6, borderRadius: 3 },
  titleText: { flex: 1, color: theme.desktop.foreground },
}));
