import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionHistorySystemPromptContext } from "@openducktor/core";
import type { MutableRefObject } from "react";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { createRepoStaleGuard } from "../support/core";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import type { ReadSessionSnapshot } from "../support/session-invariants";
import { loadSessionPromptContext } from "../support/session-prompt";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";

export type SessionHistoryLoaderAdapter = Pick<AgentEnginePort, "loadSessionHistory">;

type LoadSessionHistorySystemPromptContext = (
  session: AgentSessionState,
) => Promise<AgentSessionHistorySystemPromptContext | undefined>;

type SessionHistoryPromptTarget = Pick<
  AgentSessionState,
  "externalSessionId" | "taskId" | "role" | "startedAt"
>;

type CreateLoadAgentSessionHistoryArgs = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  adapter: SessionHistoryLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  taskRef: MutableRefObject<TaskCard[]>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

const INITIAL_SESSION_HISTORY_LIMIT = 600;

const markSessionHistoryLoading = ({
  identity,
  readSessionSnapshot,
  updateSession,
}: {
  identity: AgentSessionIdentity;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
}): AgentSessionState | null => {
  const currentSession = readSessionSnapshot(identity);
  if (!currentSession) {
    return null;
  }

  if (currentSession.historyLoadState === "loaded") {
    return currentSession;
  }

  return updateSession(identity, (current) =>
    current.historyLoadState === "loaded" ? current : { ...current, historyLoadState: "loading" },
  );
};

const resetLoadingSessionHistory = (
  identity: AgentSessionIdentity,
  updateSession: UpdateSession,
): AgentSessionState | null =>
  updateSession(identity, (current) =>
    current.historyLoadState === "loading"
      ? {
          ...current,
          historyLoadState: "not_requested",
        }
      : current,
  );

const failSessionHistoryLoad = (
  identity: AgentSessionIdentity,
  updateSession: UpdateSession,
): AgentSessionState | null =>
  updateSession(identity, (current) =>
    current.historyLoadState === "loaded" ? current : { ...current, historyLoadState: "failed" },
  );

const buildSessionHistorySystemPromptContext = async ({
  workspaceId,
  tasks,
  session,
  loadRepoPromptOverrides,
}: {
  workspaceId: string;
  tasks: readonly TaskCard[];
  session: SessionHistoryPromptTarget;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
}): Promise<AgentSessionHistorySystemPromptContext | undefined> => {
  if (session.role === null) {
    return undefined;
  }

  const task = tasks.find((task) => task.id === session.taskId);
  if (!task) {
    throw new Error(
      `Cannot load history for '${session.externalSessionId}': task '${session.taskId}' is unavailable.`,
    );
  }

  const { systemPrompt } = await loadSessionPromptContext({
    workspaceId,
    role: session.role,
    task,
    loadRepoPromptOverrides,
  });

  return {
    systemPrompt,
    startedAt: session.startedAt,
  };
};

export const loadSessionHistoryIntoStore = async ({
  repoPath,
  adapter,
  readSessionSnapshot,
  updateSession,
  identity,
  loadSystemPromptContext,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  identity: AgentSessionIdentity;
  loadSystemPromptContext?: LoadSessionHistorySystemPromptContext;
  isStaleRepoOperation: () => boolean;
}): Promise<AgentSessionState | null> => {
  if (isStaleRepoOperation()) {
    return null;
  }

  const loadingSession = markSessionHistoryLoading({
    identity,
    readSessionSnapshot,
    updateSession,
  });
  if (!loadingSession) {
    return null;
  }

  if (loadingSession.historyLoadState === "loaded") {
    return loadingSession;
  }

  const finishStaleHistoryLoad = (): null => {
    resetLoadingSessionHistory(identity, updateSession);
    return null;
  };

  try {
    const systemPromptContext = await loadSystemPromptContext?.(loadingSession);

    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    const history = await adapter.loadSessionHistory({
      ...toRuntimeSessionRef(repoPath, loadingSession),
      ...(systemPromptContext ? { systemPromptContext } : {}),
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    });

    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    return updateSession(identity, (current) => applyLoadedSessionHistory(current, history));
  } catch {
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }
    const failedSession = failSessionHistoryLoad(identity, updateSession);
    return failedSession?.historyLoadState === "loaded" ? failedSession : null;
  }
};

export const createLoadAgentSessionHistory = ({
  workspaceRepoPath,
  workspaceId,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  readSessionSnapshot,
  updateSession,
  taskRef,
  loadRepoPromptOverrides,
}: CreateLoadAgentSessionHistoryArgs): ((
  sessionIdentity: AgentSessionIdentity,
) => Promise<AgentSessionState | null>) => {
  return async (sessionIdentity: AgentSessionIdentity): Promise<AgentSessionState | null> => {
    if (!workspaceRepoPath || !workspaceId) {
      throw new Error("Cannot load agent session history without an active workspace.");
    }

    const repoPath = workspaceRepoPath;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });
    if (isStaleRepoOperation()) {
      return null;
    }

    if (!readSessionSnapshot(sessionIdentity)) {
      throw new Error(
        `Cannot load history for unknown session '${sessionIdentity.externalSessionId}'.`,
      );
    }

    return loadSessionHistoryIntoStore({
      repoPath,
      adapter,
      readSessionSnapshot,
      updateSession,
      identity: sessionIdentity,
      loadSystemPromptContext: (session) =>
        buildSessionHistorySystemPromptContext({
          workspaceId,
          tasks: taskRef.current,
          session,
          loadRepoPromptOverrides,
        }),
      isStaleRepoOperation,
    });
  };
};
