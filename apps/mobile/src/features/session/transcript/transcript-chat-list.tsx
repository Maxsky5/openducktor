import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import {
  NO_TOOL_RUNS,
  readToolRunClassifier,
} from "@openducktor/frontend-core/sessions/transcript/tool-runs";
import { useDevicePreferences } from "@/app-shell/app-services";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { type FlashListRef, type ListRenderItemInfo, type ViewToken } from "@shopify/flash-list";
import { FlashList } from "@/ui/flash-list";
import {
  type ComponentRef,
  memo,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  findNodeHandle,
  type LayoutChangeEvent,
  Platform,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import Animated, {
  Easing,
  type LayoutAnimation,
  type LayoutAnimationsValues,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet as ThemedStyleSheet } from "react-native-unistyles";
import {
  CellIndexProvider,
  cellStartOffset,
  createFoldMotionController,
  FOLD_MOTION_MS,
  type FoldMotion,
  type FoldMotionList,
  FoldMotionListProvider,
  FoldMotionProvider,
  useFoldMotion,
  useFoldMotionList,
} from "./transcript-fold-motion";
import { redrawOnScroll } from "../../../../modules/openducktor-scroll";
import { BOTTOM_EDGE_HEIGHT } from "./transcript-follow";
import { messageParts } from "./transcript-message-parts";
import {
  topRowIndex,
  type TranscriptListItem,
  type TranscriptListItems,
  type TranscriptListKind,
  transcriptListItems,
} from "./transcript-list-items";
import { type ListPlace, placeOf } from "./transcript-list-slots";
import { TranscriptNotice } from "./transcript-notice";
import { TranscriptNoticeContext } from "./transcript-notice-context";
import { TranscriptRow } from "./transcript-row";
import type { RowStateStore } from "./transcript-row-state";
import { messageRowKind, type PresentToolCall } from "./transcript-row-type";
import { type TranscriptFullView, TranscriptRowsProvider } from "./transcript-rows-context";
import { createVisibleRowsStore, rowKeysNearViewport } from "./transcript-visibility";
import { useTranscriptRowsContext } from "./use-transcript-rows";

export type TranscriptChatListProps = {
  kind: TranscriptListKind;
  rows: readonly AgentChatTranscriptRow[];
  /** True for the list on screen. A hidden list waits at its start, ready for a jump. */
  shown: boolean;
  listRef: RefObject<FlashListRef<TranscriptListItem> | null>;
  /** The items of the list, for the jumps to a row. */
  itemsRef: RefObject<TranscriptListItems | null>;
  rowState: RowStateStore;
  presentToolCall: PresentToolCall;
  onOpenSubagent: (identity: AgentSessionIdentity) => void;
  openFullView: (view: TranscriptFullView) => void;
  /** The list moved, or its content changed size. A list reports a full place when it shows. */
  onPlace: (place: ListPlace, scrolled: boolean) => void;
  /** The list on screen came to rest after a drag or a fling. */
  onRest: () => void;
  /** The transcript index of the row at the top of the screen. */
  onTopRow: (rowIndex: number) => void;
  accessibilityActions: readonly AccessibilityActionInfo[];
  onAccessibilityAction: (event: AccessibilityActionEvent) => void;
};

const keyExtractor = (item: TranscriptListItem): string => item.key;

// The render function never changes, so a change of the streaming message or of a Subagent
// count renders only the rows that read it, not every mounted cell.
const renderItem = ({ item }: ListRenderItemInfo<TranscriptListItem>): ReactElement => {
  switch (item.kind) {
    case "bottom_edge":
      return BOTTOM_SPACE;
    case "top_edge":
      return <TopEdge />;
    default:
      return <TranscriptRow item={item} />;
  }
};

/**
 * A transcript cell. A cell lower on the screen draws over the cells above it, and its surface is
 * opaque, so the rows under a part that opens or folds cover that part while they move. When the
 * list moved the cell for a resize, the cell starts at its old place and glides to its new place
 * on the UI thread.
 */
function TranscriptCell({
  ref,
  style,
  onLayout,
  index,
  children,
}: {
  ref?: Ref<ComponentRef<typeof View>>;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  index: number;
  children?: ReactNode;
}): ReactElement {
  const list = useFoldMotionList();
  const fold = useFoldMotion();
  const reducedMotion = useReducedMotion();
  const offset = reducedMotion ? 0 : cellStartOffset(fold, index);
  // The start offset mounts with the new layout as a plain style, without a layout animation, so
  // Fabric shows both in one frame. A frame later, the cell gets its layout animation, and a frame
  // after that, its offset goes back to zero and the animation glides it home.
  const phase = offset === 0 ? null : (fold?.phase ?? null);
  const start = useMemo(
    () => (phase === "start" || phase === "arm" ? { top: offset } : null),
    [offset, phase],
  );
  useEffect(() => {
    if (!list || !fold || (phase !== "start" && phase !== "arm")) return;
    const { id } = fold;
    const frame = requestAnimationFrame(() => list.motions.advance(id));
    return () => cancelAnimationFrame(frame);
  }, [fold, list, phase]);
  const layer = useMemo(
    () => ({ zIndex: list?.inverted ? -index : index }),
    [index, list?.inverted],
  );
  return (
    <View ref={ref} style={[style, layer]} onLayout={onLayout}>
      <Animated.View
        style={[cellStyles.surface, start]}
        {...(phase === "arm" || phase === "run" ? GLIDE_HOME : NO_GLIDE)}
      >
        <CellIndexProvider value={index}>{children}</CellIndexProvider>
      </Animated.View>
    </View>
  );
}

/** Starts and ends gently, so no frame moves the rows much more than its neighbors. */
const GLIDE = { duration: FOLD_MOTION_MS, easing: Easing.bezier(0.4, 0, 0.2, 1) };

/**
 * The layout animation of the content of a cell. Reanimated runs it in the mount that changes the
 * layout, so it starts where that mount puts the content. Content that comes back from a start
 * offset to its place glides there. Any other change, such as a start offset or a new height,
 * shows at once.
 */
const glideHome = (values: LayoutAnimationsValues): LayoutAnimation => {
  "worklet";
  const home = values.targetOriginY === 0 && values.currentOriginY !== 0;
  return {
    initialValues: {
      originX: values.targetOriginX,
      originY: home ? values.currentOriginY : values.targetOriginY,
      width: values.targetWidth,
      height: values.targetHeight,
    },
    animations: home ? { originY: withTiming(0, GLIDE) } : {},
  };
};

const GLIDE_HOME = { layout: glideHome };
const NO_GLIDE = {};

function TopEdge(): ReactElement {
  const notice = use(TranscriptNoticeContext);
  return notice ? <TranscriptNotice notice={notice} /> : TOP_SPACE;
}

/**
 * One FlashList of the transcript, of one kind. The `latest` list is inverted: a streamed message
 * grows up from the bottom edge, the keyboard keeps the latest message in view, and earlier rows
 * mount at the far end of the list, where they move no row in view. So a scroll toward earlier
 * messages never moves the rows. The `first` list starts at the first message. FlashList mounts
 * the rows near the screen, measures them, reuses the views of the rows that leave for rows of the
 * same type, and keeps the rows in view in place when other rows change. A part that opens grows
 * down in both lists, except at the latest message, where the transcript keeps its bottom in
 * view. A hidden list stays mounted, so a jump to it shows its rows in the next frame.
 */
export const TranscriptChatList = memo(function TranscriptChatList({
  kind,
  rows,
  shown,
  listRef,
  itemsRef,
  rowState,
  presentToolCall,
  onOpenSubagent,
  openFullView,
  onPlace,
  onRest,
  onTopRow,
  accessibilityActions,
  onAccessibilityAction,
}: TranscriptChatListProps): ReactElement {
  const groupToolCalls = useDevicePreferences((state) => state.preferences.groupToolCalls);
  const list = useMemo(
    () =>
      transcriptListItems(
        kind,
        rows,
        (row) => messageParts(row, presentToolCall),
        groupToolCalls ? readToolRunClassifier(presentToolCall) : NO_TOOL_RUNS,
      ),
    [groupToolCalls, kind, presentToolCall, rows],
  );
  const { items } = list;
  useLayoutEffect(() => {
    itemsRef.current = list;
  }, [itemsRef, list]);

  // The rows that open or fold move the cells of this list with a FLIP motion.
  const [foldMotion, setFoldMotion] = useState<FoldMotion | null>(null);
  const [foldMotions] = useState(() => createFoldMotionController(setFoldMotion));
  const foldList = useMemo<FoldMotionList>(
    () => ({
      motions: foldMotions,
      inverted: kind === "latest",
      firstVisibleIndex: () => listRef.current?.computeVisibleIndices().startIndex ?? 0,
      resizeRow: (index, delta) => listRef.current?.resizeItem(index, delta),
    }),
    [foldMotions, kind, listRef],
  );

  // Images and isolated pages load only in the rows near the screen of the list on screen.
  const [visibleRows] = useState(createVisibleRowsStore);
  const viewableIndices = useRef<readonly number[]>([]);
  useEffect(() => {
    visibleRows.setVisible(shown ? rowKeysNearViewport(items, viewableIndices.current) : []);
  }, [items, shown, visibleRows]);

  // On Android, the scroll view draws each scroll in the frame of the layout change that caused
  // it. One call per list is enough.
  const redrawsOnScroll = useRef(false);
  const onLayout = useCallback(() => {
    if (Platform.OS !== "android" || redrawsOnScroll.current) return;
    const viewTag = findNodeHandle(listRef.current?.getNativeScrollRef() ?? null);
    if (viewTag === null || viewTag === undefined) return;
    redrawsOnScroll.current = true;
    void redrawOnScroll(viewTag);
  }, [listRef]);

  const context = useTranscriptRowsContext({
    visibleRows,
    rowState,
    presentToolCall,
    onOpenSubagent,
    openFullView,
  });
  // Each row type has its own views, so a reused view renders a row of the same kind.
  const getItemType = useCallback(
    (item: TranscriptListItem): string =>
      item.kind === "message" ? messageRowKind(item.message, presentToolCall).kind : item.kind,
    [presentToolCall],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      onPlace(placeOf(kind, contentOffset.y, contentSize.height, layoutMeasurement.height), true);
    },
    [kind, onPlace],
  );
  // A new list has no scroll event, so its content size places the reader.
  const contentHeight = useRef(0);
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeight.current = height;
      const list = listRef.current;
      if (!list) return;
      onPlace(
        placeOf(kind, list.getAbsoluteLastScrollOffset(), height, list.getWindowSize().height),
        false,
      );
    },
    [kind, listRef, onPlace],
  );
  const shownRef = useRef(shown);
  const onRestShown = useCallback(() => {
    if (shownRef.current) onRest();
  }, [onRest]);
  const reportTopRow = useCallback(() => {
    const shownList = itemsRef.current;
    const top = shownList === null ? null : topRowIndex(shownList, viewableIndices.current);
    if (top !== null) onTopRow(top);
  }, [itemsRef, onTopRow]);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<TranscriptListItem>[] }) => {
      viewableIndices.current = viewableItems.flatMap((token) =>
        token.index === null ? [] : [token.index],
      );
      if (!shownRef.current) return;
      visibleRows.setVisible(
        rowKeysNearViewport(itemsRef.current?.items ?? [], viewableIndices.current),
      );
      reportTopRow();
    },
    [itemsRef, reportTopRow, visibleRows],
  );
  // A list that shows reports where the reader is. A list that hides goes back to its start, ready
  // for the next jump. The scroll command stops a fling first.
  useLayoutEffect(() => {
    const list = listRef.current;
    const changed = shownRef.current !== shown;
    shownRef.current = shown;
    if (!changed || list === null) return;
    const offset = list.getAbsoluteLastScrollOffset();
    if (!shown) {
      if (offset !== 0) list.scrollToOffset({ offset: 0, animated: false });
      return;
    }
    onPlace(placeOf(kind, offset, contentHeight.current, list.getWindowSize().height), true);
    reportTopRow();
  }, [kind, listRef, onPlace, reportTopRow, shown]);

  return (
    <View
      style={[StyleSheet.absoluteFill, shown ? null : styles.hidden]}
      pointerEvents={shown ? "auto" : "none"}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
    >
      <TranscriptRowsProvider value={context}>
        <FoldMotionListProvider value={foldList}>
          <FoldMotionProvider value={foldMotion}>
            <FlashList
              ref={listRef}
              data={items}
              inverted={kind === "latest"}
              drawDistance={DRAW_DISTANCE}
              renderItem={renderItem}
              CellRendererComponent={TranscriptCell}
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              onLayout={onLayout}
              onScroll={onScroll}
              onContentSizeChange={onContentSizeChange}
              onViewableItemsChanged={onViewableItemsChanged}
              onScrollEndDrag={onRestShown}
              onMomentumScrollEnd={onRestShown}
              // As on desktop, no scroll bar: the list measures rows as they come near.
              showsVerticalScrollIndicator={false}
              // A drag closes the keyboard; a tap keeps it. The composer suggestions float over the
              // transcript, and Android gives their taps to the list below them too.
              keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
              keyboardShouldPersistTaps="always"
              accessibilityLabel="Transcript"
              accessibilityActions={accessibilityActions}
              onAccessibilityAction={onAccessibilityAction}
            />
          </FoldMotionProvider>
        </FoldMotionListProvider>
      </TranscriptRowsProvider>
    </View>
  );
});

// The surface of the screen, so a moving cell covers the cells under it.
const cellStyles = ThemedStyleSheet.create((theme) => ({
  surface: { backgroundColor: theme.colors.background },
}));

// The desktop transcript `pt-4 pb-4`.
const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  bottomSpace: { height: BOTTOM_EDGE_HEIGHT },
  topSpace: { height: 16 },
});
const BOTTOM_SPACE = <View style={styles.bottomSpace} />;
/**
 * The distance in points past each edge of the screen that the list renders. Transcript rows vary
 * in height, so with the 250-point default a fast fling shows empty space until rows render.
 */
const DRAW_DISTANCE = 1000;
const TOP_SPACE = <View style={styles.topSpace} />;
