import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionHistorySystemPromptContext } from "@openducktor/core";
import type { MutableRefObject } from "react";
import { type AgentSessionCollection, getAgentSession } from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { createRepoStaleGuard } from "../support/core";
import { mergeHistoryMessages } from "../support/history-message-merge";
import { createSessionMessagesState, getSessionMessageCount } from "../support/messages";
import { historyToChatMessages, historyToSessionContextUsage } from "../support/persistence";
import {
  buildHistoryRuntimeContext,
  withSessionHistoryRuntimeContext,
} from "./session-history-runtime-context";
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

type CreateLoadAgentSessionHistoryArgs = {
  activeWorkspace: ActiveWorkspace | null;
  adapter: SessionHistoryLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  sessionsRef: SessionsSnapshotRef;
  updateSession: UpdateSession;
  taskRef: MutableRefObject<TaskCard[]>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

const INITIAL_SESSION_HISTORY_LIMIT = 600;

const shouldLoadSessionHistory = (session: AgentSessionState): boolean => {
  if (session.historyLoadState === "not_requested") {
    return true;
  }
  return session.historyLoadState === "failed" && getSessionMessageCount(session) > 0;
};

const releaseStaleHistoryLoad = ({
  session,
  updateSession,
}: {
  session: AgentSessionState;
  updateSession: UpdateSession;
}): void => {
  updateSession(
    session,
    (current) =>
      current.historyLoadState === "loading"
        ? { ...current, historyLoadState: "not_requested" }
        : current,
    { persist: false },
  );
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
      releaseStaleHistoryLoad({ session: claimedSession, updateSession });
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
      releaseStaleHistoryLoad({ session: claimedSession, updateSession });
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

export const createLoadAgentSessionHistory = ({
  activeWorkspace,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  sessionsRef,
  updateSession,
  taskRef,
  loadRepoPromptOverrides,
}: CreateLoadAgentSessionHistoryArgs): ((
  sessionIdentity: AgentSessionIdentity,
) => Promise<SessionHistoryLoadResult>) => {
  return async (sessionIdentity: AgentSessionIdentity): Promise<SessionHistoryLoadResult> => {
    if (!activeWorkspace?.repoPath) {
      throw new Error("Cannot load agent session history without an active workspace.");
    }

    const repoPath = activeWorkspace.repoPath;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });
    if (isStaleRepoOperation()) {
      return { externalSessionId: sessionIdentity.externalSessionId, status: "stale" };
    }

    const session = getAgentSession(sessionsRef.current, sessionIdentity);
    if (!session) {
      throw new Error(
        `Cannot load history for unknown session '${sessionIdentity.externalSessionId}'.`,
      );
    }

    const [historySession] = await withSessionHistoryRuntimeContext({
      sessions: [session],
      context: buildHistoryRuntimeContext({
        activeWorkspace,
        tasks: taskRef.current,
        loadRepoPromptOverrides,
      }),
    });
    if (!historySession || isStaleRepoOperation()) {
      return { externalSessionId: sessionIdentity.externalSessionId, status: "stale" };
    }

    const [result] = await loadSessionHistorySnapshots({
      repoPath,
      adapter,
      sessionsRef,
      updateSession,
      sessions: [historySession],
      isStaleRepoOperation,
    });

    return result ?? { externalSessionId: sessionIdentity.externalSessionId, status: "skipped" };
  };
};
