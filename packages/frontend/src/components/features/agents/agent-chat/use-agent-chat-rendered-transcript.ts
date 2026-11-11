import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentChatThreadModel } from "./agent-chat.types";
import type { AgentChatTranscriptPresentation } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";
import { useAgentChatSettings } from "./agent-chat-settings-context";
import { isAssistantMessageStreaming } from "@openducktor/frontend-core/sessions/transcript/agent-chat-streaming";
import type {
  AgentChatTranscriptRow,
  AgentChatUserMessageAnchor,
} from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { useAgentChatTranscriptModel } from "@openducktor/frontend-core/sessions/transcript/use-agent-chat-transcript-model";
import type { AgentChatTranscriptNavigation } from "./use-agent-chat-transcript-navigation";
import { useAgentChatWindow } from "./use-agent-chat-window";
import { useAgentChatRowEntryMotion } from "./use-agent-chat-row-entry-motion";
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
  isActive: boolean;
  activeStreamingAssistantMessageId: string | null;
};

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
  const turnAnchors = useMemo(
    () =>
      windowRows.layoutKey === ""
        ? transcriptModelState.turnAnchors
        : buildAgentChatTurnAnchors(windowRows.rows),
    [windowRows, transcriptModelState.turnAnchors],
  );
  const userMessageAnchors = useMemo(
    () => foldUserMessageAnchors(transcriptModelState.userMessageAnchors, windowRows.layoutKey),
    [transcriptModelState.userMessageAnchors, windowRows.layoutKey],
  );
  const {
    visibleRows,
    visibleTurnAnchors,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
    navigation,
  } = useAgentChatWindow({
    rows: windowRows.rows,
    turnAnchors,
    displayedSessionKey,
    shouldResetForTranscriptLoad: effectiveShouldResetTranscriptWindow,
    messagesContainerRef,
    messagesContentRef,
  });
  useAgentChatRowEntryMotion({
    sessionKey: displayedSessionKey,
    rows: transcriptModelState.rows,
    contentRef: messagesContentRef,
    mountedRows: visibleRows,
  });
  const latestUserTurnKey = useMemo(() => {
    if (!displayedSessionKey || !transcriptModelState.lastUserMessageKey) {
      return null;
    }

    return transcriptModelState.lastUserMessageKey;
  }, [displayedSessionKey, transcriptModelState.lastUserMessageKey]);
  const renderedTurns = useMemo<AgentChatRenderedTurn[]>(() => {
    if (visibleRows.length === 0) {
      return [];
    }

    return visibleTurnAnchors.map((turn) => {
      const rows = visibleRows.slice(turn.startRow, turn.endRowExclusive);
      const activeStreamingAssistantMessageId = getTurnActiveStreamingAssistantMessageId(
        rows,
        transcriptModelState.activeStreamingAssistantMessageId,
      );
      return {
        key: turn.key,
        rows,
        items: buildTurnItems(rows, windowRows, folds, collapseFinishedRuns),
        isActive: turn.key === latestUserTurnKey,
        activeStreamingAssistantMessageId,
      };
    });
  }, [
    collapseFinishedRuns,
    folds,
    latestUserTurnKey,
    visibleRows,
    visibleTurnAnchors,
    windowRows,
    transcriptModelState.activeStreamingAssistantMessageId,
  ]);

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
