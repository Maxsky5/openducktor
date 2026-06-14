import type { AgentEnginePort, AgentSessionHistorySystemPromptContext } from "@openducktor/core";
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

export type SessionHistoryLoaderAdapter = Pick<AgentEnginePort, "loadSessionHistory">;

export type SessionHistoryLoadResult =
  | { externalSessionId: string; status: "applied" }
  | { externalSessionId: string; status: "stale" }
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
  if (session.historyLoadState === "not_requested") {
    return true;
  }
  return session.historyLoadState === "failed" && getSessionMessageCount(session) > 0;
};

export const loadSessionHistorySnapshot = async ({
  repoPath,
  adapter,
  updateSession,
  session,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  updateSession: UpdateSession;
  session: AgentSessionHistoryTarget;
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult> => {
  if (isStaleRepoOperation()) {
    return { externalSessionId: session.externalSessionId, status: "stale" };
  }

  updateSession(session, (current) => ({ ...current, historyLoadState: "loading" }), {
    persist: false,
  });

  try {
    const history = await adapter.loadSessionHistory({
      repoPath,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
      externalSessionId: session.externalSessionId,
      ...(session.systemPromptContext ? { systemPromptContext: session.systemPromptContext } : {}),
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    });

    if (isStaleRepoOperation()) {
      return { externalSessionId: session.externalSessionId, status: "stale" };
    }

    const historyMessages = historyToChatMessages(history, {
      role: session.role,
      selectedModel: session.selectedModel,
    });
    const loadedMessages = createSessionMessagesState(session.externalSessionId, historyMessages);
    const historyContextUsage = historyToSessionContextUsage(history);
    updateSession(
      session,
      (current) => ({
        ...current,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
        historyLoadState: "loaded",
        contextUsage: current.contextUsage ?? historyContextUsage,
        messages: mergeHistoryMessages(current.externalSessionId, loadedMessages, current.messages),
      }),
      { persist: false },
    );
    return { externalSessionId: session.externalSessionId, status: "applied" };
  } catch (error) {
    if (isStaleRepoOperation()) {
      return { externalSessionId: session.externalSessionId, status: "stale" };
    }
    updateSession(session, (current) => ({ ...current, historyLoadState: "failed" }), {
      persist: false,
    });
    return { externalSessionId: session.externalSessionId, status: "failed", error };
  }
};

export const loadSessionHistorySnapshots = async ({
  repoPath,
  adapter,
  updateSession,
  sessions,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  updateSession: UpdateSession;
  sessions: AgentSessionHistoryTarget[];
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult[]> =>
  Promise.all(
    sessions.map((session) => {
      return loadSessionHistorySnapshot({
        repoPath,
        adapter,
        updateSession,
        session,
        isStaleRepoOperation,
      });
    }),
  );
