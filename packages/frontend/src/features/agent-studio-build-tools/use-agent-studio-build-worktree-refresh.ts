import { useEffect, useRef } from "react";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  findFirstChangedSessionMessageIndex,
  forEachSessionMessage,
  forEachSessionMessageFrom,
} from "@/state/operations/agent-orchestrator/support/messages";

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

type PreviousBuildSessionSnapshot = {
  sessionKey: string;
  messages: AgentSessionState["messages"];
  historyLoadState: AgentSessionState["historyLoadState"];
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

const replaceSetContents = (target: Set<string>, source: Set<string>): void => {
  target.clear();
  for (const value of source) {
    target.add(value);
  }
};

const buildSessionSnapshot = (
  sessionKey: string,
  session: AgentSessionState,
): PreviousBuildSessionSnapshot => ({
  sessionKey,
  messages: session.messages,
  historyLoadState: session.historyLoadState,
});

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
  const previousSessionRef = useRef<PreviousBuildSessionSnapshot | null>(null);

  useEffect(() => {
    if (role !== "build" || loadedSession?.role !== "build") {
      return;
    }

    const loadedSessionKey = agentSessionIdentityKey(loadedSession);
    const previousSession = previousSessionRef.current;

    if (previousSession?.sessionKey !== loadedSessionKey) {
      previousSessionRef.current = buildSessionSnapshot(loadedSessionKey, loadedSession);
      replaceSetContents(processedToolMessageKeys, seedProcessedToolMessageKeys(loadedSession));
      return;
    }

    const isHistoryLoadApplying =
      loadedSession.historyLoadState === "loading" ||
      (previousSession.historyLoadState === "loading" &&
        loadedSession.historyLoadState === "loaded");

    if (isHistoryLoadApplying) {
      previousSessionRef.current = buildSessionSnapshot(loadedSessionKey, loadedSession);
      replaceSetContents(processedToolMessageKeys, seedProcessedToolMessageKeys(loadedSession));
      return;
    }

    const firstChangedMessageIndex = findFirstChangedSessionMessageIndex(
      previousSession.messages,
      loadedSession,
    );
    if (firstChangedMessageIndex < 0) {
      previousSessionRef.current = buildSessionSnapshot(loadedSessionKey, loadedSession);
      return;
    }

    let shouldRefresh = false;
    forEachSessionMessageFrom(loadedSession, firstChangedMessageIndex, (message) => {
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

    previousSessionRef.current = buildSessionSnapshot(loadedSessionKey, loadedSession);

    if (shouldRefresh) {
      void refreshWorktree("soft");
    }
  }, [loadedSession, processedToolMessageKeys, refreshWorktree, role]);
}
