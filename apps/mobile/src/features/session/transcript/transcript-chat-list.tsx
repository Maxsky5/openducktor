import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
  type ViewToken,
} from "@shopify/flash-list";
import {
  memo,
  type ReactElement,
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
  StyleSheet,
  View,
} from "react-native";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import { BOTTOM_EDGE_HEIGHT, FOLLOW_THRESHOLD_FRACTION } from "./transcript-follow";
import { messageParts } from "./transcript-message-parts";
import {
  topRowIndex,
  type TranscriptListItem,
  type TranscriptListItems,
  type TranscriptListKind,
  transcriptListItems,
} from "./transcript-list-items";
import type { ListPlace } from "./transcript-list-slots";
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

function TopEdge(): ReactElement {
  const notice = use(TranscriptNoticeContext);
  return notice ? <TranscriptNotice notice={notice} /> : TOP_SPACE;
}

/**
 * One FlashList of the transcript, of one kind. The `latest` list renders from the bottom and
 * scrolls new content into view while the reader is near the bottom, as the FlashList chat setup.
 * The `first` list starts at the first message. FlashList mounts the rows near the screen,
 * measures them, reuses the views of the rows that leave for rows of the same type, and keeps the
 * first row in view in place when rows above it change. A part that opens grows down, so the rows
 * above it do not move. A hidden list stays mounted, so a jump to it shows its rows in the next
 * frame.
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
  const list = useMemo(
    () => transcriptListItems(rows, (row) => messageParts(row, presentToolCall)),
    [presentToolCall, rows],
  );
  const { items } = list;
  useLayoutEffect(() => {
    itemsRef.current = list;
  }, [itemsRef, list]);

  // Images and isolated pages load only in the rows near the screen of the list on screen.
  const [visibleRows] = useState(createVisibleRowsStore);
  const viewableIndices = useRef<readonly number[]>([]);
  useEffect(() => {
    visibleRows.setVisible(shown ? rowKeysNearViewport(items, viewableIndices.current) : []);
  }, [items, shown, visibleRows]);

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
      onPlace(placeOf(contentOffset.y, contentSize.height, layoutMeasurement.height), true);
    },
    [onPlace],
  );
  // A new list has no scroll event, so its content size places the reader.
  const contentHeight = useRef(0);
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeight.current = height;
      const list = listRef.current;
      if (!list) return;
      onPlace(
        placeOf(list.getAbsoluteLastScrollOffset(), height, list.getWindowSize().height),
        false,
      );
    },
    [listRef, onPlace],
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
      if (kind === "latest") void list.scrollToEnd({ animated: false });
      else if (offset !== 0) list.scrollToOffset({ offset: 0, animated: false });
      return;
    }
    onPlace(placeOf(offset, contentHeight.current, list.getWindowSize().height), true);
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
        <FlashList
          ref={listRef}
          data={items}
          maintainVisibleContentPosition={kind === "latest" ? FOLLOW_LATEST : KEEP_POSITION}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
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
      </TranscriptRowsProvider>
    </View>
  );
});

// The desktop transcript `pt-4 pb-4`.
const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  bottomSpace: { height: BOTTOM_EDGE_HEIGHT },
  topSpace: { height: 16 },
});
/** The place of the reader from the scroll offset of a list. */
const placeOf = (offset: number, contentHeight: number, viewportHeight: number): ListPlace => ({
  fromTop: offset,
  fromBottom: contentHeight - offset - viewportHeight,
  viewportHeight,
});
const BOTTOM_SPACE = <View style={styles.bottomSpace} />;
/** The `latest` list starts at the bottom and follows new content while the reader is near it. */
const FOLLOW_LATEST = {
  startRenderingFromBottom: true,
  autoscrollToBottomThreshold: FOLLOW_THRESHOLD_FRACTION,
  // The follow state reads each scroll, so the scroll lands at once.
  animateAutoScrollToBottom: false,
};
/** The `first` list keeps the first row in view in place, the FlashList default. */
const KEEP_POSITION = {};
const TOP_SPACE = <View style={styles.topSpace} />;
