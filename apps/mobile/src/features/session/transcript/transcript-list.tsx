import type { AgentChatTranscriptNotice } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { FlashListRef } from "@shopify/flash-list";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useListViewport, ViewportProvider } from "@/rich-content/viewport/use-in-viewport";
import type { JumpToLatestSignal } from "./jump-to-latest-signal";
import { TranscriptChatList } from "./transcript-chat-list";
import { TranscriptLatestButton, TranscriptTopButton } from "./transcript-controls";
import {
  initialTranscriptFollowState,
  reduceTranscriptFollow,
  type TranscriptFollowEvent,
  type TranscriptFollowState,
  transcriptContentKey,
} from "./transcript-follow";
import { TranscriptFullViewSheet } from "./transcript-full-view";
import type {
  TranscriptListItem,
  TranscriptListItems,
  TranscriptListKind,
} from "./transcript-list-items";
import { TranscriptNoticeContext } from "./transcript-notice-context";
import type { PresentToolCall } from "./transcript-row-type";
import type { TranscriptFullView } from "./transcript-rows-context";
import {
  isNearListStart,
  jumpSlot,
  LIST_START,
  type ListPlace,
  PARTNER_SLOT,
  SLOT_KIND,
  TRANSCRIPT_LIST_SLOTS,
  type TranscriptListSlot,
} from "./transcript-list-slots";
import {
  type ShownTranscriptList,
  TRANSCRIPT_ACTIONS,
  useTranscriptListJumps,
} from "./use-transcript-list-jumps";
import { useRowState } from "./use-transcript-rows";

export type TranscriptListProps = {
  rows: readonly AgentChatTranscriptRow[];
  activeStreamingMessageId: string | null;
  messagesVersion: number;
  notice: AgentChatTranscriptNotice | null;
  presentToolCall: PresentToolCall;
  subagentPendingCountBySessionKey: Readonly<Record<string, number>>;
  onOpenSubagent: (identity: AgentSessionIdentity) => void;
  latestSignal: JumpToLatestSignal;
};

/** A list that waits mounts in idle time, so it does not slow the transcript down. */
const PREPARE_TIMEOUT_MS = 2000;

/**
 * The rows that a list shows. A list shows each change at once only while it is on screen and the
 * reader follows the latest message, or reads the list of the first rows, which adds new rows at
 * its far end. Otherwise its rows do not change: in the inverted list, a row that grows or comes
 * under the screen moves the rows in view, and a list that waits does no work.
 */
const useShownRows = (
  rows: readonly AgentChatTranscriptRow[],
  live: boolean,
): readonly AgentChatTranscriptRow[] => {
  const [heldRows, setHeldRows] = useState<readonly AgentChatTranscriptRow[] | null>(null);
  if (!live && heldRows === null) setHeldRows(rows);
  if (live && heldRows !== null) setHeldRows(null);
  return live ? rows : (heldRows ?? rows);
};

/**
 * The transcript of the open session as FlashList chats. A list measures only the rows that it
 * mounts, so only its start has an exact place. A jump to an end shows a list that waits, hidden,
 * at that end, so the jump shows its rows in the next frame. The list that leaves goes back to its
 * start. The transcript opens on an inverted list at the latest message, and mounts the other
 * lists in idle time.
 */
export function TranscriptList({
  rows,
  activeStreamingMessageId,
  messagesVersion,
  notice,
  presentToolCall,
  subagentPendingCountBySessionKey,
  onOpenSubagent,
  latestSignal,
}: TranscriptListProps): ReactElement {
  const latestA = useRef<FlashListRef<TranscriptListItem>>(null);
  const latestB = useRef<FlashListRef<TranscriptListItem>>(null);
  const firstA = useRef<FlashListRef<TranscriptListItem>>(null);
  const firstB = useRef<FlashListRef<TranscriptListItem>>(null);
  const refs = useMemo(() => ({ latestA, latestB, firstA, firstB }), []);
  const latestAItems = useRef<TranscriptListItems>(null);
  const latestBItems = useRef<TranscriptListItems>(null);
  const firstAItems = useRef<TranscriptListItems>(null);
  const firstBItems = useRef<TranscriptListItems>(null);
  const itemRefs = useMemo(
    () => ({
      latestA: latestAItems,
      latestB: latestBItems,
      firstA: firstAItems,
      firstB: firstBItems,
    }),
    [],
  );
  const [shownSlot, setShownSlot] = useState<TranscriptListSlot>("latestA");
  /** The list on screen. A jump sets it before the list shows, so the leaving list stops reporting. */
  const shownSlotRef = useRef(shownSlot);
  const [ready, setReady] = useState<ReadonlySet<TranscriptListSlot>>(() => new Set(["latestA"]));
  const places = useRef<Record<TranscriptListSlot, ListPlace>>({
    latestA: LIST_START,
    latestB: LIST_START,
    firstA: LIST_START,
    firstB: LIST_START,
  });

  const contentKey = transcriptContentKey({
    rowCount: rows.length,
    lastRowKey: rows[rows.length - 1]?.key ?? null,
    messagesVersion,
  });
  // React runs a reducer component again for each dispatch, even when its state stays the same.
  // Scroll events and streamed changes come many times a second, so the state renders again only
  // when the follow reducer returns a new state.
  const [initialFollow] = useState(() => initialTranscriptFollowState(contentKey));
  const followRef = useRef<TranscriptFollowState>(initialFollow);
  const [follow, setFollow] = useState(initialFollow);
  const dispatch = useCallback((event: TranscriptFollowEvent) => {
    const current = followRef.current;
    const next = reduceTranscriptFollow(current, event);
    if (next === current) return;
    followRef.current = next;
    setFollow(next);
  }, []);
  useEffect(() => {
    dispatch({ type: "content_changed", contentKey });
  }, [contentKey, dispatch]);
  // A list that is not mounted yet takes the rows of the moment it mounts.
  const live = (slot: TranscriptListSlot): boolean =>
    !ready.has(slot) || (slot === shownSlot && (SLOT_KIND[slot] === "first" || follow.atBottom));
  const slotRows = {
    latestA: useShownRows(rows, live("latestA")),
    latestB: useShownRows(rows, live("latestB")),
    firstA: useShownRows(rows, live("firstA")),
    firstB: useShownRows(rows, live("firstB")),
  };
  // The jumps read the rows of the list on screen, so they do not change with each streamed change.
  const shownRows = useRef(slotRows[shownSlot]);
  useLayoutEffect(() => {
    shownRows.current = slotRows[shownSlot];
  });

  const rowState = useRowState(activeStreamingMessageId, subagentPendingCountBySessionKey);
  const [fullView, setFullView] = useState<TranscriptFullView | null>(null);
  const closeFullView = useCallback(() => setFullView(null), []);
  // Images and isolated pages in visible rows check their own position against this viewport.
  const viewport = useListViewport();
  const checkViewport = viewport.onScroll;
  // Each image and isolated page near the screen measures its position on a viewport check. They
  // load one screen ahead, so a check after each quarter screen of scroll, and at rest, is enough.
  const checkedAt = useRef<number | null>(null);
  const notifyViewport = useCallback(
    (place: ListPlace | null) => {
      const offset = place?.fromTop ?? null;
      if (
        place !== null &&
        offset !== null &&
        checkedAt.current !== null &&
        Math.abs(offset - checkedAt.current) < place.viewportHeight / 4
      ) {
        return;
      }
      checkedAt.current = offset;
      checkViewport();
    },
    [checkViewport],
  );

  const prepare = useCallback((slot: TranscriptListSlot) => {
    setReady((current) => (current.has(slot) ? current : new Set([...current, slot])));
  }, []);
  const idleCallbacks = useRef(new Map<TranscriptListSlot, number>());
  const prepareInIdleTime = useCallback(
    (slot: TranscriptListSlot) => {
      if (idleCallbacks.current.has(slot)) return;
      const handle = requestIdleCallback(() => prepare(slot), { timeout: PREPARE_TIMEOUT_MS });
      idleCallbacks.current.set(slot, handle);
    },
    [prepare],
  );
  useEffect(() => {
    const pending = idleCallbacks.current;
    prepareInIdleTime("firstA");
    return () => {
      for (const handle of pending.values()) cancelIdleCallback(handle);
    };
  }, [prepareInIdleTime]);

  const show = useCallback(
    (kind: TranscriptListKind) => {
      const target = jumpSlot(shownSlotRef.current, kind);
      shownSlotRef.current = target;
      prepare(target);
      setShownSlot(target);
    },
    [prepare],
  );

  const onPlace = useCallback(
    (slot: TranscriptListSlot, place: ListPlace, scrolled: boolean) => {
      places.current[slot] = place;
      if (slot !== shownSlotRef.current) return;
      if (scrolled) {
        notifyViewport(place);
        dispatch({
          type: "scrolled",
          distanceFromBottom: place.fromBottom,
          distanceFromTop: place.fromTop,
          viewportHeight: place.viewportHeight,
        });
      } else {
        dispatch({
          type: "content_measured",
          distanceFromTop: place.fromTop,
          viewportHeight: place.viewportHeight,
        });
      }
      // Far from the start of the list on screen, the other list of its kind gets ready.
      if (!isNearListStart(SLOT_KIND[slot], place)) prepareInIdleTime(PARTNER_SLOT[slot]);
    },
    [dispatch, notifyViewport, prepareInIdleTime],
  );
  const placeHandlers = useMemo(() => {
    const report = (slot: TranscriptListSlot) => (place: ListPlace, scrolled: boolean) =>
      onPlace(slot, place, scrolled);
    return {
      latestA: report("latestA"),
      latestB: report("latestB"),
      firstA: report("firstA"),
      firstB: report("firstB"),
    };
  }, [onPlace]);
  // The list of the first rows hands over to an inverted list when the reader comes to rest at its
  // end, so the transcript follows the latest message again. Both show the same rows there.
  const onRest = useCallback(() => {
    notifyViewport(null);
    const slot = shownSlotRef.current;
    if (SLOT_KIND[slot] !== "first" || places.current[slot].fromBottom >= 1) return;
    dispatch({ type: "jumped_to_latest" });
    show("latest");
  }, [dispatch, notifyViewport, show]);
  /** The transcript index of the row at the top of the screen, for the user message moves. */
  const topRow = useRef(0);
  const onTopRow = useCallback((rowIndex: number) => {
    topRow.current = rowIndex;
  }, []);

  const shown = useMemo<ShownTranscriptList>(
    () => ({
      kind: SLOT_KIND[shownSlot],
      rows: () => shownRows.current,
      items: () => itemRefs[shownSlotRef.current].current,
      list: refs[shownSlot],
      place: () => places.current[shownSlotRef.current],
      show,
    }),
    [itemRefs, refs, show, shownSlot],
  );
  const jumps = useTranscriptListJumps({ shown, topRow, dispatch, latestSignal });

  return (
    <ViewportProvider value={viewport.store}>
      <View ref={viewport.frameRef} style={styles.fill} onLayout={viewport.onFrameLayout}>
        <TranscriptNoticeContext value={notice}>
          {TRANSCRIPT_LIST_SLOTS.map((slot) =>
            ready.has(slot) ? (
              <TranscriptChatList
                key={slot}
                kind={SLOT_KIND[slot]}
                rows={slotRows[slot]}
                shown={slot === shownSlot}
                listRef={refs[slot]}
                itemsRef={itemRefs[slot]}
                rowState={rowState}
                presentToolCall={presentToolCall}
                onOpenSubagent={onOpenSubagent}
                openFullView={setFullView}
                onPlace={placeHandlers[slot]}
                onRest={onRest}
                onTopRow={onTopRow}
                accessibilityActions={TRANSCRIPT_ACTIONS}
                onAccessibilityAction={jumps.onAccessibilityAction}
              />
            ) : null,
          )}
        </TranscriptNoticeContext>
        <TranscriptTopButton atTop={follow.atTop} onJumpToTop={jumps.jumpToTop} />
        <TranscriptLatestButton
          atBottom={follow.atBottom}
          hasNewActivity={follow.hasNewActivity}
          onJumpToLatest={jumps.jumpToLatest}
        />
        <TranscriptFullViewSheet view={fullView} onClose={closeFullView} />
      </View>
    </ViewportProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
