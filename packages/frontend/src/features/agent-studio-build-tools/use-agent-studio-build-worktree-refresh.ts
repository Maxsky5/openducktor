import { useEffect, useRef } from "react";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { forEachSessionMessage } from "@/state/operations/agent-orchestrator/support/messages";

import type { AgentSessionState } from "@/types/agent-orchestrator";
import { shouldRefreshGitPanelAfterToolCompletion } from "./git-panel-refresh-policy";

type BuildWorktreeRefreshSelectedView = {
  role: string | null;
  loadedSession: AgentSessionState | null;
};

type UseAgentStudioBuildWorktreeRefreshArgs = {
  selectedView: BuildWorktreeRefreshSelectedView;
  refreshWorktree: GitDiffRefresh;
};

const seedCompletedToolMessageKeys = (
  sessionKey: string,
  session: AgentSessionState,
): Set<string> => {
  const messageKeys = new Set<string>();
  forEachSessionMessage(session, (message) => {
    const meta = message.meta;
    if (meta?.kind !== "tool" || meta.status !== "completed") {
      return;
    }

    messageKeys.add(`${sessionKey}:${message.id}`);
  });
  return messageKeys;
};

const replaceSetContents = (target: Set<string>, source: Set<string>): void => {
  target.clear();
  for (const value of source) {
    target.add(value);
  }
};

export function useAgentStudioBuildWorktreeRefresh({
  selectedView,
  refreshWorktree,
}: UseAgentStudioBuildWorktreeRefreshArgs): void {
  const { role, loadedSession } = selectedView;
  const processedToolMessageKeysRef = useRef<Set<string> | null>(null);
  if (processedToolMessageKeysRef.current === null) {
    processedToolMessageKeysRef.current = new Set<string>();
  }
  const processedToolMessageKeys = processedToolMessageKeysRef.current;
  const currentSessionKeyRef = useRef<string | null>(null);
  const wasHistoryLoadingRef = useRef(false);

  useEffect(() => {
    if (role !== "build" || loadedSession?.role !== "build") {
      return;
    }

    const loadedSessionKey = agentSessionIdentityKey(loadedSession);

    if (currentSessionKeyRef.current !== loadedSessionKey) {
      currentSessionKeyRef.current = loadedSessionKey;
      wasHistoryLoadingRef.current = loadedSession.historyLoadState === "loading";
      replaceSetContents(
        processedToolMessageKeys,
        seedCompletedToolMessageKeys(loadedSessionKey, loadedSession),
      );
      return;
    }

    if (loadedSession.historyLoadState === "loading" || wasHistoryLoadingRef.current) {
      wasHistoryLoadingRef.current = loadedSession.historyLoadState === "loading";
      replaceSetContents(
        processedToolMessageKeys,
        seedCompletedToolMessageKeys(loadedSessionKey, loadedSession),
      );
      return;
    }

    let shouldRefresh = false;
    forEachSessionMessage(loadedSession, (message) => {
      const meta = message.meta;
      if (meta?.kind !== "tool" || meta.status !== "completed") {
        return;
      }

      const messageKey = `${loadedSessionKey}:${message.id}`;
      if (processedToolMessageKeys.has(messageKey)) {
        return;
      }

      processedToolMessageKeys.add(messageKey);
      if (shouldRefreshGitPanelAfterToolCompletion(meta)) {
        shouldRefresh = true;
      }
    });

    if (shouldRefresh) {
      void refreshWorktree("soft");
    }
  }, [loadedSession, processedToolMessageKeys, refreshWorktree, role]);
}
