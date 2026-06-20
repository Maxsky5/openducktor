import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { useAgentChatSettings } from "./agent-chat-settings-context";
import type { AgentChatWindowRow, AgentChatWindowTurn } from "./agent-chat-thread-windowing";
import { useAgentChatTranscriptRows } from "./use-agent-chat-transcript-rows";
import { useAgentChatWindow } from "./use-agent-chat-window";

const STAGED_WINDOW_INITIAL_ROWS = 8;
const STAGED_WINDOW_ROW_BATCH = 8;

const TRANSCRIPT_ROWS_PENDING_NOTICE: NonNullable<AgentChatThreadModel["transcriptNotice"]> =
  Object.freeze({
    kind: "session_loading",
    severity: "loading",
    title: "Loading session",
    description: "Loading the selected conversation.",
  });

export type AgentChatRenderedTurn = {
  key: string;
  rows: AgentChatWindowRow[];
  isActive: boolean;
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
  activeStreamingAssistantMessageId: string | null;
  allowTurnContainment: boolean;
  transcriptNotice: AgentChatThreadModel["transcriptNotice"];
  isNearBottom: boolean;
  isNearTop: boolean;
  scrollToBottom: () => void;
  scrollToTop: () => void;
};

type StagedTranscriptWindow = {
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
};

const shouldStageWindow = ({
  completedSessionKeys,
  forceStage,
  rowCount,
  sessionKey,
}: {
  completedSessionKeys: Set<string>;
  forceStage?: boolean;
  rowCount: number;
  sessionKey: string;
}): boolean =>
  rowCount > STAGED_WINDOW_INITIAL_ROWS &&
  (forceStage === true || !completedSessionKeys.has(sessionKey));

function useStagedTranscriptWindow({
  sessionKey,
  rows,
  turns,
  onBeforePrepend,
}: {
  sessionKey: string | null;
  rows: AgentChatWindowRow[];
  turns: AgentChatWindowTurn[];
  onBeforePrepend: () => void;
}): StagedTranscriptWindow {
  const [rowCount, setRowCount] = useState(() =>
    sessionKey !== null && rows.length > STAGED_WINDOW_INITIAL_ROWS
      ? STAGED_WINDOW_INITIAL_ROWS
      : rows.length,
  );
  const rowCountRef = useRef(rowCount);
  const frameRef = useRef<number | null>(null);
  const activeSessionKeyRef = useRef<string | null>(null);
  const completedSessionKeysRef = useRef<Set<string>>(new Set());
  const previousSessionKeyRef = useRef<string | null>(sessionKey);
  const previousSessionKey = previousSessionKeyRef.current;
  const renderedSwitchedSession =
    previousSessionKey !== null && sessionKey !== null && previousSessionKey !== sessionKey;

  useEffect(() => {
    const updateRowCount = (nextRowCount: number): void => {
      rowCountRef.current = nextRowCount;
      setRowCount((current) => (current === nextRowCount ? current : nextRowCount));
    };

    if (frameRef.current !== null) {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const effectPreviousSessionKey = previousSessionKeyRef.current;
    const effectSwitchedSession =
      effectPreviousSessionKey !== null &&
      sessionKey !== null &&
      effectPreviousSessionKey !== sessionKey;
    previousSessionKeyRef.current = sessionKey;

    if (effectSwitchedSession && sessionKey !== null) {
      completedSessionKeysRef.current.delete(sessionKey);
    }

    if (sessionKey === null) {
      activeSessionKeyRef.current = null;
      updateRowCount(rows.length);
      return;
    }

    const shouldStage = shouldStageWindow({
      completedSessionKeys: completedSessionKeysRef.current,
      forceStage: effectSwitchedSession,
      rowCount: rows.length,
      sessionKey,
    });

    if (!shouldStage) {
      activeSessionKeyRef.current = null;
      updateRowCount(rows.length);
      return;
    }

    const activeSessionKey = sessionKey;
    const isContinuingActiveSession = activeSessionKeyRef.current === sessionKey;
    activeSessionKeyRef.current = activeSessionKey;
    let nextRowCount = Math.min(
      rows.length,
      isContinuingActiveSession ? rowCountRef.current : STAGED_WINDOW_INITIAL_ROWS,
    );
    updateRowCount(nextRowCount);

    if (nextRowCount >= rows.length) {
      activeSessionKeyRef.current = null;
      completedSessionKeysRef.current.add(activeSessionKey);
      return;
    }

    const step = (): void => {
      if (activeSessionKeyRef.current !== activeSessionKey) {
        frameRef.current = null;
        return;
      }

      nextRowCount = Math.min(rows.length, nextRowCount + STAGED_WINDOW_ROW_BATCH);
      onBeforePrepend();
      updateRowCount(nextRowCount);

      if (nextRowCount >= rows.length) {
        frameRef.current = null;
        activeSessionKeyRef.current = null;
        completedSessionKeysRef.current.add(activeSessionKey);
        return;
      }

      frameRef.current = globalThis.requestAnimationFrame(step);
    };

    frameRef.current = globalThis.requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) {
        globalThis.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [onBeforePrepend, rows.length, sessionKey]);

  return useMemo(() => {
    if (
      sessionKey === null ||
      !shouldStageWindow({
        completedSessionKeys: completedSessionKeysRef.current,
        forceStage: renderedSwitchedSession,
        rowCount: rows.length,
        sessionKey,
      })
    ) {
      return { rows, turns };
    }

    const effectiveRowCount =
      renderedSwitchedSession && activeSessionKeyRef.current !== sessionKey
        ? Math.min(rows.length, STAGED_WINDOW_INITIAL_ROWS)
        : rowCount;

    if (effectiveRowCount >= rows.length) {
      return { rows, turns };
    }

    const rowStart = Math.max(0, rows.length - effectiveRowCount);
    return {
      rows: rows.slice(rowStart),
      turns: turns
        .filter((turn) => turn.end >= rowStart)
        .map((turn) => ({
          key: turn.key,
          start: Math.max(turn.start, rowStart) - rowStart,
          end: turn.end - rowStart,
        })),
    };
  }, [renderedSwitchedSession, rowCount, rows, sessionKey, turns]);
}

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
  const { transcriptState: transcriptRowsState, isTranscriptRowsMissing } =
    useAgentChatTranscriptRows({
      session,
      showThinkingMessages,
    });
  const effectiveShouldResetTranscriptWindow =
    shouldResetTranscriptWindow || isTranscriptRowsMissing;
  const effectiveTranscriptNotice =
    transcriptNotice ?? (isTranscriptRowsMissing ? TRANSCRIPT_ROWS_PENDING_NOTICE : null);
  const {
    windowedRows,
    windowedTurns,
    isNearBottom,
    isNearTop,
    preserveScrollBeforeStagedPrepend,
    scrollToBottom,
    scrollToTop,
    scrollToBottomOnSend,
  } = useAgentChatWindow({
    rows: transcriptRowsState.rows,
    turns: transcriptRowsState.turns,
    displayedSessionKey,
    shouldResetForTranscriptLoad: effectiveShouldResetTranscriptWindow,
    isSessionWorking,
    messagesContainerRef,
    messagesContentRef,
    syncBottomAfterComposerLayoutRef,
  });
  const stagedTranscript = useStagedTranscriptWindow({
    sessionKey: displayedSessionKey,
    rows: windowedRows,
    turns: windowedTurns,
    onBeforePrepend: preserveScrollBeforeStagedPrepend,
  });
  const latestUserTurnKey = useMemo(() => {
    if (!displayedSessionKey || !transcriptRowsState.lastUserMessageId) {
      return null;
    }

    return `${displayedSessionKey}:${transcriptRowsState.lastUserMessageId}`;
  }, [displayedSessionKey, transcriptRowsState.lastUserMessageId]);
  const renderedTurns = useMemo<AgentChatRenderedTurn[]>(() => {
    if (stagedTranscript.rows.length === 0) {
      return [];
    }

    return stagedTranscript.turns.map((turn) => ({
      key: turn.key,
      rows: stagedTranscript.rows.slice(turn.start, turn.end + 1),
      isActive: turn.key === latestUserTurnKey,
    }));
  }, [latestUserTurnKey, stagedTranscript.rows, stagedTranscript.turns]);

  useLayoutEffect(() => {
    scrollToBottomOnSendRef.current = scrollToBottomOnSend;
  }, [scrollToBottomOnSend, scrollToBottomOnSendRef]);

  return {
    messagesContentRef,
    renderedTurns,
    activeStreamingAssistantMessageId: transcriptRowsState.activeStreamingAssistantMessageId,
    allowTurnContainment: !transcriptRowsState.hasAttachmentMessages,
    transcriptNotice: effectiveTranscriptNotice,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
  };
}
