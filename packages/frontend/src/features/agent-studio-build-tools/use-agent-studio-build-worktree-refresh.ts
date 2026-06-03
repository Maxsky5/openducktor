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
  isSessionHistoryHydrating: boolean;
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

export function useAgentStudioBuildWorktreeRefresh({
  viewRole,
  activeSession,
  isSessionHistoryHydrating,
  refreshWorktree,
}: UseAgentStudioBuildWorktreeRefreshArgs): void {
  const processedToolMessageKeysRef = useRef(new Set<string>());
  const previousSessionIdRef = useRef<string | null>(null);
  const previousMessagesRef = useRef<AgentSessionState["messages"] | null>(null);
  const wasSessionHistoryHydratingRef = useRef(false);
  const completedToolKeysBeforeHydrationRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (viewRole !== "build" || activeSession?.role !== "build") {
      return;
    }

    if (isSessionHistoryHydrating) {
      if (!wasSessionHistoryHydratingRef.current) {
        completedToolKeysBeforeHydrationRef.current =
          collectCompletedGitPanelRefreshToolKeys(activeSession);
      }
      wasSessionHistoryHydratingRef.current = true;
      return;
    }

    if (previousSessionIdRef.current !== activeSession.externalSessionId) {
      previousSessionIdRef.current = activeSession.externalSessionId;
      previousMessagesRef.current = activeSession.messages;
      processedToolMessageKeysRef.current = seedProcessedToolMessageKeys(activeSession);
      return;
    }

    if (wasSessionHistoryHydratingRef.current) {
      wasSessionHistoryHydratingRef.current = false;
      previousMessagesRef.current = activeSession.messages;
      const completedToolKeysBeforeHydration = completedToolKeysBeforeHydrationRef.current;
      processedToolMessageKeysRef.current = completedToolKeysBeforeHydration
        ? new Set(completedToolKeysBeforeHydration)
        : seedProcessedToolMessageKeys(activeSession);
      completedToolKeysBeforeHydrationRef.current = null;
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
      if (processedToolMessageKeysRef.current.has(messageKey)) {
        return;
      }

      processedToolMessageKeysRef.current.add(messageKey);
      if (shouldRefreshGitPanelAfterToolCompletion(meta)) {
        shouldRefresh = true;
      }
    });

    previousMessagesRef.current = activeSession.messages;

    if (shouldRefresh) {
      void refreshWorktree("soft");
    }
  }, [activeSession, isSessionHistoryHydrating, refreshWorktree, viewRole]);
}
