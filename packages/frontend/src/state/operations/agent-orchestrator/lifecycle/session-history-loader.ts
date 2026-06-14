import type { AgentEnginePort, AgentSessionHistorySystemPromptContext } from "@openducktor/core";
import { type AgentSessionCollection, getAgentSession } from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { mergeHistoryMessages } from "../support/history-message-merge";
import { createSessionMessagesState, getSessionMessageCount } from "../support/messages";
import { historyToChatMessages, historyToSessionContextUsage } from "../support/persistence";
import type { SessionRepoReadinessState } from "./session-view-lifecycle";

type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionsSnapshotRef = { readonly current: AgentSessionCollection };

export type SessionHistoryLoaderAdapter = Pick<AgentEnginePort, "loadSessionHistory">;

export type SessionHistoryLoadResult =
  | { externalSessionId: string; status: "applied" }
  | { externalSessionId: string; status: "stale" }
  | { externalSessionId: string; status: "skipped" }
  | { externalSessionId: string; status: "failed"; error: unknown };

export type AgentSessionHistoryTarget = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "runtimeKind"
  | "workingDirectory"
  | "role"
  | "selectedModel"
  | "taskId"
  | "startedAt"
> & {
  systemPromptContext?: AgentSessionHistorySystemPromptContext;
};

const INITIAL_SESSION_HISTORY_LIMIT = 600;

const shouldLoadSessionHistory = (session: AgentSessionState): boolean => {
  if (session.historyLoadState === "not_requested") {
    return true;
  }
  return session.historyLoadState === "failed" && getSessionMessageCount(session) > 0;
};

export const shouldLoadSelectedSessionHistory = ({
  repoReadinessState,
  session,
}: {
  repoReadinessState: SessionRepoReadinessState;
  session: AgentSessionState | null;
}): boolean => {
  if (repoReadinessState !== "ready" || !session) {
    return false;
  }
  return shouldLoadSessionHistory(session);
};

export const loadSessionHistorySnapshot = async ({
  repoPath,
  adapter,
  sessionsRef,
  updateSession,
  session,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  sessionsRef: SessionsSnapshotRef;
  updateSession: UpdateSession;
  session: AgentSessionHistoryTarget;
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult> => {
  if (isStaleRepoOperation()) {
    return { externalSessionId: session.externalSessionId, status: "stale" };
  }

  const currentSession = getAgentSession(sessionsRef.current, session);
  if (!currentSession || !shouldLoadSessionHistory(currentSession)) {
    return { externalSessionId: session.externalSessionId, status: "skipped" };
  }

  updateSession(
    currentSession,
    (current) => {
      if (!shouldLoadSessionHistory(current)) {
        return current;
      }
      return { ...current, historyLoadState: "loading" };
    },
    {
      persist: false,
    },
  );

  const claimedSession = getAgentSession(sessionsRef.current, currentSession);
  if (claimedSession?.historyLoadState !== "loading") {
    return { externalSessionId: session.externalSessionId, status: "skipped" };
  }

  try {
    const history = await adapter.loadSessionHistory({
      repoPath,
      runtimeKind: claimedSession.runtimeKind,
      workingDirectory: claimedSession.workingDirectory,
      externalSessionId: claimedSession.externalSessionId,
      ...(session.systemPromptContext ? { systemPromptContext: session.systemPromptContext } : {}),
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    });

    if (isStaleRepoOperation()) {
      return { externalSessionId: session.externalSessionId, status: "stale" };
    }

    const historyMessages = historyToChatMessages(history, {
      role: claimedSession.role,
      selectedModel: claimedSession.selectedModel,
    });
    const loadedMessages = createSessionMessagesState(
      claimedSession.externalSessionId,
      historyMessages,
    );
    const historyContextUsage = historyToSessionContextUsage(history);
    updateSession(
      claimedSession,
      (current) => ({
        ...current,
        runtimeKind: claimedSession.runtimeKind,
        workingDirectory: claimedSession.workingDirectory,
        historyLoadState: "loaded",
        contextUsage: current.contextUsage ?? historyContextUsage,
        messages: mergeHistoryMessages(current.externalSessionId, loadedMessages, current.messages),
      }),
      { persist: false },
    );
    return { externalSessionId: claimedSession.externalSessionId, status: "applied" };
  } catch (error) {
    if (isStaleRepoOperation()) {
      return { externalSessionId: session.externalSessionId, status: "stale" };
    }
    updateSession(
      claimedSession,
      (current) =>
        current.historyLoadState === "loading"
          ? { ...current, historyLoadState: "failed" }
          : current,
      {
        persist: false,
      },
    );
    return { externalSessionId: session.externalSessionId, status: "failed", error };
  }
};

export const loadSessionHistorySnapshots = async ({
  repoPath,
  adapter,
  sessionsRef,
  updateSession,
  sessions,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  sessionsRef: SessionsSnapshotRef;
  updateSession: UpdateSession;
  sessions: AgentSessionHistoryTarget[];
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult[]> =>
  Promise.all(
    sessions.map((session) => {
      return loadSessionHistorySnapshot({
        repoPath,
        adapter,
        sessionsRef,
        updateSession,
        session,
        isStaleRepoOperation,
      });
    }),
  );
