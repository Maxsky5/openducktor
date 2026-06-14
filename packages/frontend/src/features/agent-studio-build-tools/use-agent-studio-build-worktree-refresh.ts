import { useEffect, useRef } from "react";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import { findFirstChangedMessageIndex } from "@/pages/agents/agent-session-message-diff";
import {
  forEachSessionMessage,
  forEachSessionMessageFrom,
} from "@/state/operations/agent-orchestrator/support/messages";

import type { AgentSessionState } from "@/types/agent-orchestrator";
import { shouldRefreshGitPanelAfterToolCompletion } from "./git-panel-refresh-policy";

type UseAgentStudioBuildWorktreeRefreshArgs = {
  viewRole: string | null;
  activeSession: AgentSessionState | null;
  isSessionViewLoading: boolean;
  refreshWorktree: GitDiffRefresh;
};

const seedProcessedToolMessageKeys = (session: AgentSessionState): Set<string> => {
  const keys = new Set<string>();
  forEachSessionMessage(session, (message) => {
    const meta = message.meta;
    if (meta?.kind !== "tool" || meta.status !== "completed") {
      return;
    }

    keys.add(`${session.externalSessionId}:${message.id}`);
  });
  return keys;
};

const collectCompletedGitPanelRefreshToolKeys = (session: AgentSessionState): Set<string> => {
  const keys = new Set<string>();
  forEachSessionMessage(session, (message) => {
    const meta = message.meta;
    if (meta?.kind !== "tool" || meta.status !== "completed") {
      return;
    }

    if (shouldRefreshGitPanelAfterToolCompletion(meta)) {
      keys.add(`${session.externalSessionId}:${message.id}`);
    }
  });
  return keys;
};

const replaceSetContents = (target: Set<string>, source: Set<string>): void => {
  target.clear();
  for (const value of source) {
    target.add(value);
  }
};

export function useAgentStudioBuildWorktreeRefresh({
  viewRole,
  activeSession,
  isSessionViewLoading,
  refreshWorktree,
}: UseAgentStudioBuildWorktreeRefreshArgs): void {
  const processedToolMessageKeysRef = useRef<Set<string> | null>(null);
  if (processedToolMessageKeysRef.current === null) {
    processedToolMessageKeysRef.current = new Set<string>();
  }
  const processedToolMessageKeys = processedToolMessageKeysRef.current;
  const previousSessionIdRef = useRef<string | null>(null);
  const previousMessagesRef = useRef<AgentSessionState["messages"] | null>(null);
  const wasSessionViewLoadingRef = useRef(false);
  const completedToolKeysBeforeViewLoadRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (viewRole !== "build" || activeSession?.role !== "build") {
      return;
    }

    if (isSessionViewLoading) {
      if (!wasSessionViewLoadingRef.current) {
        completedToolKeysBeforeViewLoadRef.current =
          collectCompletedGitPanelRefreshToolKeys(activeSession);
      }
      wasSessionViewLoadingRef.current = true;
      return;
    }

    if (previousSessionIdRef.current !== activeSession.externalSessionId) {
      previousSessionIdRef.current = activeSession.externalSessionId;
      previousMessagesRef.current = activeSession.messages;
      replaceSetContents(processedToolMessageKeys, seedProcessedToolMessageKeys(activeSession));
      return;
    }

    if (wasSessionViewLoadingRef.current) {
      wasSessionViewLoadingRef.current = false;
      previousMessagesRef.current = activeSession.messages;
      const completedToolKeysBeforeViewLoad = completedToolKeysBeforeViewLoadRef.current;
      replaceSetContents(
        processedToolMessageKeys,
        completedToolKeysBeforeViewLoad ?? seedProcessedToolMessageKeys(activeSession),
      );
      completedToolKeysBeforeViewLoadRef.current = null;
      return;
    }

    const firstChangedMessageIndex = findFirstChangedMessageIndex(
      previousMessagesRef.current,
      activeSession,
    );
    if (firstChangedMessageIndex < 0) {
      previousMessagesRef.current = activeSession.messages;
      return;
    }

    let shouldRefresh = false;
    forEachSessionMessageFrom(activeSession, firstChangedMessageIndex, (message) => {
      const meta = message.meta;
      if (meta?.kind !== "tool" || meta.status !== "completed") {
        return;
      }

      const messageKey = `${activeSession.externalSessionId}:${message.id}`;
      if (processedToolMessageKeys.has(messageKey)) {
        return;
      }

      processedToolMessageKeys.add(messageKey);
      if (shouldRefreshGitPanelAfterToolCompletion(meta)) {
        shouldRefresh = true;
      }
    });

    previousMessagesRef.current = activeSession.messages;

    if (shouldRefresh) {
      void refreshWorktree("soft");
    }
  }, [activeSession, isSessionViewLoading, processedToolMessageKeys, refreshWorktree, viewRole]);
}
