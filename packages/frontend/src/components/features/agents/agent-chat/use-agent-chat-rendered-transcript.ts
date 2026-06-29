import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { useAgentChatSettings } from "./agent-chat-settings-context";
import { isAssistantMessageStreaming } from "./agent-chat-streaming";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";
import { useAgentChatTranscriptModel } from "./use-agent-chat-transcript-model";
import { useAgentChatWindow } from "./use-agent-chat-window";

const TRANSCRIPT_MODEL_PENDING_NOTICE: NonNullable<AgentChatThreadModel["transcriptNotice"]> =
  Object.freeze({
    kind: "session_loading",
    severity: "loading",
    title: "Loading session",
    description: "Loading the selected conversation.",
  });

export type AgentChatRenderedTurn = {
  key: string;
  rows: AgentChatTranscriptRow[];
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
  session: AgentChatThreadModel["session"];
  displayedSessionKey: AgentChatThreadModel["displayedSessionKey"];
  isSessionWorking: AgentChatThreadModel["isSessionWorking"];
  shouldResetTranscriptWindow: AgentChatThreadModel["shouldResetTranscriptWindow"];
  transcriptNotice: AgentChatThreadModel["transcriptNotice"];
  messagesContainerRef: AgentChatThreadModel["messagesContainerRef"];
  scrollToBottomOnSendRef: AgentChatThreadModel["scrollToBottomOnSendRef"];
  syncBottomAfterComposerLayoutRef: AgentChatThreadModel["syncBottomAfterComposerLayoutRef"];
};

type UseAgentChatRenderedTranscriptResult = {
  messagesContentRef: RefObject<HTMLDivElement | null>;
  renderedTurns: AgentChatRenderedTurn[];
  allowTurnContainment: boolean;
  transcriptNotice: AgentChatThreadModel["transcriptNotice"];
  isNearBottom: boolean;
  isNearTop: boolean;
  scrollToBottom: () => void;
  scrollToTop: () => void;
};

export function useAgentChatRenderedTranscript({
  session,
  displayedSessionKey,
  isSessionWorking,
  shouldResetTranscriptWindow,
  transcriptNotice,
  messagesContainerRef,
  scrollToBottomOnSendRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatRenderedTranscriptArgs): UseAgentChatRenderedTranscriptResult {
  const { showThinkingMessages } = useAgentChatSettings();
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const { transcriptState: transcriptModelState, isTranscriptModelMissing } =
    useAgentChatTranscriptModel({
      session,
      showThinkingMessages,
    });
  const effectiveShouldResetTranscriptWindow =
    shouldResetTranscriptWindow || isTranscriptModelMissing;
  const effectiveTranscriptNotice =
    transcriptNotice ?? (isTranscriptModelMissing ? TRANSCRIPT_MODEL_PENDING_NOTICE : null);
  const {
    visibleRows,
    visibleTurnAnchors,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
    scrollToBottomOnSend,
  } = useAgentChatWindow({
    rows: transcriptModelState.rows,
    turnAnchors: transcriptModelState.turnAnchors,
    displayedSessionKey,
    shouldResetForTranscriptLoad: effectiveShouldResetTranscriptWindow,
    isSessionWorking,
    messagesContainerRef,
    messagesContentRef,
    syncBottomAfterComposerLayoutRef,
  });
  const latestUserTurnKey = useMemo(() => {
    if (!displayedSessionKey || !transcriptModelState.lastUserMessageId) {
      return null;
    }

    return `${displayedSessionKey}:${transcriptModelState.lastUserMessageId}`;
  }, [displayedSessionKey, transcriptModelState.lastUserMessageId]);
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
        isActive: turn.key === latestUserTurnKey,
        activeStreamingAssistantMessageId,
      };
    });
  }, [
    latestUserTurnKey,
    visibleRows,
    visibleTurnAnchors,
    transcriptModelState.activeStreamingAssistantMessageId,
  ]);

  useLayoutEffect(() => {
    scrollToBottomOnSendRef.current = scrollToBottomOnSend;
  }, [scrollToBottomOnSend, scrollToBottomOnSendRef]);

  return {
    messagesContentRef,
    renderedTurns,
    allowTurnContainment: !transcriptModelState.hasAttachmentMessages,
    transcriptNotice: effectiveTranscriptNotice,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
  };
}
