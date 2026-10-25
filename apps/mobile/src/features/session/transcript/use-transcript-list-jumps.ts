import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { FlashListRef } from "@shopify/flash-list";
import { type RefObject, useCallback, useEffect } from "react";
import type { AccessibilityActionEvent, AccessibilityActionInfo } from "react-native";
import { useFeedbackStore } from "@/app-shell/app-services";
import type { JumpToLatestSignal } from "./jump-to-latest-signal";
import type { TranscriptFollowEvent } from "./transcript-follow";
import type {
  TranscriptListItem,
  TranscriptListItems,
  TranscriptListKind,
} from "./transcript-list-items";
import { isNearListStart, type ListPlace } from "./transcript-list-slots";
import { nextUserMessageIndex, previousUserMessageIndex } from "./transcript-navigation";

const FIRST_MESSAGE = "first_message";
const PREVIOUS_USER_MESSAGE = "previous_user_message";
const NEXT_USER_MESSAGE = "next_user_message";
const LATEST_MESSAGE = "latest_message";

export const TRANSCRIPT_ACTIONS: readonly AccessibilityActionInfo[] = [
  { name: PREVIOUS_USER_MESSAGE, label: "Previous user message" },
  { name: NEXT_USER_MESSAGE, label: "Next user message" },
  { name: FIRST_MESSAGE, label: "Jump to the first message" },
  { name: LATEST_MESSAGE, label: "Jump to the latest message" },
];

/**
 * The list on screen, and a way to show a list that waits, hidden, at its start. It reads the rows
 * and the place when a jump needs them, so it changes only when another list shows.
 */
export type ShownTranscriptList = {
  kind: TranscriptListKind;
  rows: () => readonly AgentChatTranscriptRow[];
  /** The items of the list on screen, or null before it mounts. */
  items: () => TranscriptListItems | null;
  list: RefObject<FlashListRef<TranscriptListItem> | null>;
  place: () => ListPlace;
  /** Shows a list that starts at `kind`. */
  show: (kind: TranscriptListKind) => void;
};

/**
 * The jumps of the transcript, instant and exact. A short jump to the start of the list on screen
 * scrolls there. A longer jump shows a list that waits, hidden, at its start. A jump to a user
 * message scrolls the list on screen to it.
 */
export const useTranscriptListJumps = ({
  shown,
  topRow,
  dispatch,
  latestSignal,
}: {
  shown: ShownTranscriptList;
  /** The transcript index of the row at the top of the screen. */
  topRow: RefObject<number>;
  dispatch: (event: TranscriptFollowEvent) => void;
  latestSignal: JumpToLatestSignal;
}) => {
  const { feedback } = useFeedbackStore();
  const { kind, rows, items, list, place, show } = shown;
  const jumpTo = useCallback(
    (target: TranscriptListKind) => {
      if (kind === target && isNearListStart(kind, place())) {
        void list.current?.scrollToIndex({ index: 0, animated: false });
        return;
      }
      show(target);
    },
    [kind, list, place, show],
  );
  const jumpToLatest = useCallback(() => {
    dispatch({ type: "jumped_to_latest" });
    jumpTo("latest");
  }, [dispatch, jumpTo]);
  const jumpToTop = useCallback(() => {
    dispatch({ type: "jumped_to_top" });
    jumpTo("first");
  }, [dispatch, jumpTo]);
  const jumpToUserMessage = useCallback(
    (direction: "previous" | "next") => {
      const anchor = topRow.current;
      const shownRows = rows();
      const index =
        direction === "previous"
          ? previousUserMessageIndex(shownRows, anchor)
          : nextUserMessageIndex(shownRows, anchor);
      const listIndex = index === null ? undefined : items()?.topItemOfRow[index];
      if (listIndex === undefined) {
        feedback.show(
          "info",
          direction === "previous" ? "No earlier user message." : "No later user message.",
        );
        return;
      }
      // The top of the screen is the view position 1 of the inverted list, and 0 of the other.
      void list.current?.scrollToIndex({
        index: listIndex,
        viewPosition: kind === "latest" ? 1 : 0,
        animated: false,
      });
    },
    [feedback, items, kind, list, rows, topRow],
  );
  // Screen readers move between turns through the actions of the list.
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case FIRST_MESSAGE:
          jumpToTop();
          break;
        case PREVIOUS_USER_MESSAGE:
          jumpToUserMessage("previous");
          break;
        case NEXT_USER_MESSAGE:
          jumpToUserMessage("next");
          break;
        case LATEST_MESSAGE:
          jumpToLatest();
          break;
      }
    },
    [jumpToLatest, jumpToTop, jumpToUserMessage],
  );
  useEffect(() => latestSignal.subscribe(jumpToLatest), [jumpToLatest, latestSignal]);
  return { jumpToLatest, jumpToTop, onAccessibilityAction };
};
