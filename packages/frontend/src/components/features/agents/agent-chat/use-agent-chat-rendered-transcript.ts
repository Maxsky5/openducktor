import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentChatThreadModel } from "./agent-chat.types";
import type { AgentChatTranscriptPresentation } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";
import { useAgentChatSettings } from "./agent-chat-settings-context";
import { isAssistantMessageStreaming } from "@openducktor/frontend-core/sessions/transcript/agent-chat-streaming";
import type {
  AgentChatTranscriptRow,
  AgentChatTurnAnchor,
  AgentChatUserMessageAnchor,
} from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { useAgentChatTranscriptModel } from "@openducktor/frontend-core/sessions/transcript/use-agent-chat-transcript-model";
import type { AgentChatTranscriptNavigation } from "./use-agent-chat-transcript-navigation";
import { useAgentChatWindow } from "./use-agent-chat-window";
import type { AgentChatScrollUnpinOptions } from "./use-agent-chat-scroll-controller";
import {
  type AgentChatRowEntryMotionControls,
  type TailOpenToolRun,
  useAgentChatRowEntryMotion,
} from "./use-agent-chat-row-entry-motion";
import { groupToolRuns } from "@openducktor/frontend-core/sessions/transcript/tool-runs";
import {
  type AgentChatTurnItem,
  buildToolRunWindowRows,
  buildTurnItems,
  foldUserMessageAnchors,
} from "./agent-chat-tool-run-layout";
import { buildAgentChatTurnAnchors } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import {
  type ToolRunActions,
  type ToolRunFoldStore,
  useCollapseFinishedToolRuns,
  useToolRunClassifier,
  useToolRunFolds,
} from "./agent-chat-tool-run-folds";
import { REVEAL_ELEMENT_EVENT } from "@/lib/reveal-element";

const TRANSCRIPT_MODEL_PENDING_NOTICE: NonNullable<AgentChatTranscriptPresentation["notice"]> =
  Object.freeze({
    kind: "session_loading",
    severity: "loading",
    title: "Loading session",
    description: "Loading the selected conversation.",
  });

export type AgentChatRenderedTurn = {
  key: string;
  rows: AgentChatTranscriptRow[];
  /** The rows of the turn, with the calls of each tool run together. */
  items: AgentChatTurnItem[];
  activeStreamingAssistantMessageId: string | null;
};

const areTurnAnchorsEqual = (
  left: readonly AgentChatTurnAnchor[],
  right: readonly AgentChatTurnAnchor[],
): boolean =>
  left.length === right.length &&
  left.every((anchor, index) => {
    const next = right[index];
    return (
      next !== undefined &&
      anchor.key === next.key &&
      anchor.startRow === next.startRow &&
      anchor.endRowExclusive === next.endRowExclusive
    );
  });

const areTurnRowsIdentical = (
  previousRows: readonly AgentChatTranscriptRow[],
  visibleRows: readonly AgentChatTranscriptRow[],
  startRow: number,
  endRowExclusive: number,
): boolean => {
  const length = endRowExclusive - startRow;
  if (previousRows.length !== length) return false;
  for (let index = 0; index < length; index += 1) {
    if (previousRows[index] !== visibleRows[startRow + index]) return false;
  }
  return true;
};

const areTurnItemsIdentical = (
  previousItems: readonly AgentChatTurnItem[],
  nextItems: readonly AgentChatTurnItem[],
): boolean =>
  previousItems.length === nextItems.length &&
  previousItems.every((item, index) => {
    const nextItem = nextItems[index];
    if (!nextItem || item.kind !== nextItem.kind) return false;
    return item.kind === "row"
      ? nextItem.kind === "row" && item.row === nextItem.row
      : item === nextItem;
  });

export const getTurnActiveStreamingAssistantMessageId = (
  rows: AgentChatTranscriptRow[],
  activeStreamingAssistantMessageId: string | null,
): string | null => {
  if (!activeStreamingAssistantMessageId) {
    return null;
  }

  // Duplicate message ids can exist in recovered transcripts; only the still-streaming assistant row
  // should make its containing turn active.
  return rows.some(
    (row) =>
      row.kind === "message" &&
      row.message.id === activeStreamingAssistantMessageId &&
      isAssistantMessageStreaming(row.message),
  )
    ? activeStreamingAssistantMessageId
    : null;
};

type UseAgentChatRenderedTranscriptArgs = {
  transcript: AgentChatThreadModel["transcript"];
  runtimePresentation: AgentChatThreadModel["runtimePresentation"];
  messagesContainerRef: AgentChatThreadModel["messagesContainerRef"];
  scrollToBottomOnSendRef: AgentChatThreadModel["scrollToBottomOnSendRef"];
  toolRunFolds: ToolRunFoldStore;
};

type UseAgentChatRenderedTranscriptResult = {
  messagesContentRef: RefObject<HTMLDivElement | null>;
  turnsClipRef: RefObject<HTMLDivElement | null>;
  turnsRef: RefObject<HTMLDivElement | null>;
  renderedTurns: AgentChatRenderedTurn[];
  transcriptNotice: AgentChatTranscriptPresentation["notice"];
  isNearBottom: boolean;
  isNearTop: boolean;
  scrollToBottom: () => void;
  scrollToTop: () => void;
  toolRunActions: ToolRunActions;
  userMessageAnchors: AgentChatUserMessageAnchor[];
  navigation: AgentChatTranscriptNavigation;
};

export function useAgentChatRenderedTranscript({
  transcript,
  runtimePresentation,
  messagesContainerRef,
  scrollToBottomOnSendRef,
  toolRunFolds,
}: UseAgentChatRenderedTranscriptArgs): UseAgentChatRenderedTranscriptResult {
  const { session, displayedSessionKey, shouldResetWindow, notice } = transcript;
  const showThinkingMessages = useAgentChatSettings()?.showThinkingMessages ?? false;
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const turnsClipRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef<HTMLDivElement | null>(null);
  const entryMotionRef = useRef<AgentChatRowEntryMotionControls | null>(null);
  const cancelEntryMotion = useCallback((options?: AgentChatScrollUnpinOptions) => {
    entryMotionRef.current?.cancelSlide(options);
  }, []);
  const handlePinnedResize = useCallback(() => {
    entryMotionRef.current?.onPinnedResize();
  }, []);
  const { transcriptState: transcriptModelState, isTranscriptModelMissing } =
    useAgentChatTranscriptModel({
      session,
      showThinkingMessages,
    });
  const effectiveShouldResetTranscriptWindow = shouldResetWindow || isTranscriptModelMissing;
  const effectiveTranscriptNotice =
    notice ?? (isTranscriptModelMissing ? TRANSCRIPT_MODEL_PENDING_NOTICE : null);
  // Each tool run is one row of the row window, so the rows after a long run stay in reach.
  const classify = useToolRunClassifier(runtimePresentation);
  const windowRows = useMemo(
    () =>
      buildToolRunWindowRows(
        transcriptModelState.rows,
        groupToolRuns(transcriptModelState.rows, classify),
      ),
    [transcriptModelState.rows, classify],
  );
  const folds = useToolRunFolds(toolRunFolds);
  const collapseFinishedRuns = useCollapseFinishedToolRuns();
  const previousTurnAnchorsRef = useRef<AgentChatTurnAnchor[]>([]);
  const turnAnchors = useMemo(() => {
    const next =
      windowRows.layoutKey === ""
        ? transcriptModelState.turnAnchors
        : buildAgentChatTurnAnchors(windowRows.rows);
    return areTurnAnchorsEqual(previousTurnAnchorsRef.current, next)
      ? previousTurnAnchorsRef.current
      : next;
  }, [windowRows, transcriptModelState.turnAnchors]);
  const userMessageAnchors = useMemo(
    () => foldUserMessageAnchors(transcriptModelState.userMessageAnchors, windowRows.layoutKey),
    [transcriptModelState.userMessageAnchors, windowRows.layoutKey],
  );
  const {
    visibleRows,
    visibleTurnAnchors,
    isLatestWindow,
    isPinned,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
    syncScrollPosition,
    navigation,
  } = useAgentChatWindow({
    rows: windowRows.rows,
    turnAnchors,
    displayedSessionKey,
    shouldResetForTranscriptLoad: effectiveShouldResetTranscriptWindow,
    messagesContainerRef,
    messagesContentRef,
    onUnpin: cancelEntryMotion,
    onPinnedResize: handlePinnedResize,
  });
  const previousTurnsRef = useRef<AgentChatRenderedTurn[]>([]);
  const previousTurnsByKeyRef = useRef<Map<string, AgentChatRenderedTurn>>(new Map());
  const renderedTurns = useMemo<AgentChatRenderedTurn[]>(() => {
    if (visibleRows.length === 0) {
      return previousTurnsRef.current.length === 0 ? previousTurnsRef.current : [];
    }

    const previousByKey = previousTurnsByKeyRef.current;
    const turns = visibleTurnAnchors.map((turn) => {
      const previous = previousByKey.get(turn.key);
      if (
        previous &&
        areTurnRowsIdentical(previous.rows, visibleRows, turn.startRow, turn.endRowExclusive)
      ) {
        const activeStreamingAssistantMessageId = getTurnActiveStreamingAssistantMessageId(
          previous.rows,
          transcriptModelState.activeStreamingAssistantMessageId,
        );
        const hasToolRunInTurn =
          previous.items.some((item) => item.kind === "tool_run") ||
          previous.rows.some((row) => windowRows.runs.has(row.key));
        const items = hasToolRunInTurn
          ? buildTurnItems(previous.rows, windowRows, folds, collapseFinishedRuns)
          : previous.items;
        if (
          previous.activeStreamingAssistantMessageId === activeStreamingAssistantMessageId &&
          (items === previous.items || areTurnItemsIdentical(previous.items, items))
        ) {
          return previous;
        }
        return {
          key: turn.key,
          rows: previous.rows,
          items,
          activeStreamingAssistantMessageId,
        };
      }

      const rows = visibleRows.slice(turn.startRow, turn.endRowExclusive);
      const activeStreamingAssistantMessageId = getTurnActiveStreamingAssistantMessageId(
        rows,
        transcriptModelState.activeStreamingAssistantMessageId,
      );
      return {
        key: turn.key,
        rows,
        items: buildTurnItems(rows, windowRows, folds, collapseFinishedRuns),
        activeStreamingAssistantMessageId,
      };
    });
    const previousTurns = previousTurnsRef.current;
    if (
      previousTurns.length === turns.length &&
      turns.every((turn, index) => turn === previousTurns[index])
    ) {
      return previousTurns;
    }
    return turns;
  }, [
    collapseFinishedRuns,
    folds,
    visibleRows,
    visibleTurnAnchors,
    windowRows,
    transcriptModelState.activeStreamingAssistantMessageId,
  ]);

  useLayoutEffect(() => {
    previousTurnAnchorsRef.current = turnAnchors;
    previousTurnsRef.current = renderedTurns;
    previousTurnsByKeyRef.current = new Map(renderedTurns.map((turn) => [turn.key, turn]));
  }, [renderedTurns, turnAnchors]);

  const tailOpenRun = useMemo<TailOpenToolRun | null>(() => {
    const lastItem = renderedTurns.at(-1)?.items.at(-1);
    if (lastItem?.kind === "tool_run" && !lastItem.folded && lastItem.earlierCallCount === 0) {
      return { runKey: lastItem.runKey, callCount: lastItem.callCount };
    }
    return null;
  }, [renderedTurns]);

  const entryMotion = useAgentChatRowEntryMotion({
    sessionKey: displayedSessionKey,
    isGrouped: classify !== null,
    rows: windowRows.rows,
    containerRef: messagesContainerRef,
    turnsClipRef,
    turnsRef,
    mountedRows: visibleRows,
    tailOpenRun,
    isPinned,
    isLatestWindow,
    syncScrollPosition,
  });

  useLayoutEffect(() => {
    entryMotionRef.current = entryMotion;
  }, [entryMotion]);

  // A transcript that follows its end stops following, so the run stays where the reader pressed
  // it. Scroll anchoring then keeps the content in view while the run changes its height.
  const toolRunActions = useMemo<ToolRunActions>(() => {
    const stopFollowing = (header: HTMLElement): void => {
      header.dispatchEvent(new Event(REVEAL_ELEMENT_EVENT, { bubbles: true }));
    };
    return {
      toggle: (runKey, header, folded) => {
        stopFollowing(header);
        toolRunFolds.choose(runKey, folded ? "open" : "folded");
      },
      showEarlier: (runKey, header, keptHidden) => {
        stopFollowing(header);
        toolRunFolds.showEarlier(runKey, keptHidden);
      },
      hideEarlier: (runKey, header) => {
        stopFollowing(header);
        toolRunFolds.hideEarlier(runKey);
      },
    };
  }, [toolRunFolds]);

  useLayoutEffect(() => {
    scrollToBottomOnSendRef.current = scrollToBottom;
  }, [scrollToBottom, scrollToBottomOnSendRef]);

  return {
    messagesContentRef,
    turnsClipRef,
    turnsRef,
    renderedTurns,
    transcriptNotice: effectiveTranscriptNotice,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
    toolRunActions,
    userMessageAnchors,
    navigation,
  };
}
