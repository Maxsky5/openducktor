import { useEffect, useRef } from "react";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { findFirstChangedMessageIndex } from "@/pages/agents/agent-session-message-diff";
import {
  forEachSessionMessage,
  forEachSessionMessageFrom,
} from "@/state/operations/agent-orchestrator/support/messages";
import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

import type { AgentSessionState } from "@/types/agent-orchestrator";
import { shouldRefreshGitPanelAfterToolCompletion } from "./git-panel-refresh-policy";

type UseAgentStudioBuildWorktreeRefreshArgs = {
  viewRole: string | null;
  activeSession: AgentSessionState | null;
  transcriptState: AgentSessionTranscriptState;
  refreshWorktree: GitDiffRefresh;
};

const seedProcessedToolMessageKeys = (session: AgentSessionState): Set<string> => {
  const keys = new Set<string>();
  const sessionKey = agentSessionIdentityKey(session);
  forEachSessionMessage(session, (message) => {
    const meta = message.meta;
    if (meta?.kind !== "tool" || meta.status !== "completed") {
      return;
    }

    keys.add(`${sessionKey}:${message.id}`);
  });
  return keys;
};

const collectCompletedGitPanelRefreshToolKeys = (session: AgentSessionState): Set<string> => {
  const keys = new Set<string>();
  const sessionKey = agentSessionIdentityKey(session);
  forEachSessionMessage(session, (message) => {
    const meta = message.meta;
    if (meta?.kind !== "tool" || meta.status !== "completed") {
      return;
    }

    if (shouldRefreshGitPanelAfterToolCompletion(meta)) {
      keys.add(`${sessionKey}:${message.id}`);
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
  transcriptState,
  refreshWorktree,
}: UseAgentStudioBuildWorktreeRefreshArgs): void {
  const isTranscriptLoading = isAgentSessionTranscriptLoading(transcriptState);
  const processedToolMessageKeysRef = useRef<Set<string> | null>(null);
  if (processedToolMessageKeysRef.current === null) {
    processedToolMessageKeysRef.current = new Set<string>();
  }
  const processedToolMessageKeys = processedToolMessageKeysRef.current;
  const previousSessionKeyRef = useRef<string | null>(null);
  const previousMessagesRef = useRef<AgentSessionState["messages"] | null>(null);
  const wasSessionViewLoadingRef = useRef(false);
  const completedToolKeysBeforeViewLoadRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (viewRole !== "build" || activeSession?.role !== "build") {
      return;
    }

    const activeSessionKey = agentSessionIdentityKey(activeSession);

    if (isTranscriptLoading) {
      if (!wasSessionViewLoadingRef.current) {
        completedToolKeysBeforeViewLoadRef.current =
          collectCompletedGitPanelRefreshToolKeys(activeSession);
      }
      wasSessionViewLoadingRef.current = true;
      return;
    }

    if (previousSessionKeyRef.current !== activeSessionKey) {
      previousSessionKeyRef.current = activeSessionKey;
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

      const messageKey = `${activeSessionKey}:${message.id}`;
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
  }, [activeSession, isTranscriptLoading, processedToolMessageKeys, refreshWorktree, viewRole]);
}
