import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentSessionHistoryMessage,
  AgentSessionHistorySystemPromptContext,
} from "@openducktor/core";
import { type MutableRefObject, useEffect } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createRepoStaleGuard } from "../support/core";
import { mergeHistoryMessages } from "../support/history-message-merge";
import { createSessionMessagesState } from "../support/messages";
import { historyToChatMessages, historyToSessionContextUsage } from "../support/persistence";
import { loadSessionPromptContext } from "../support/session-prompt";

type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type ReadSessionSnapshot = (identity: AgentSessionIdentity) => AgentSessionState | null;

export type SessionHistoryLoaderAdapter = Pick<AgentEnginePort, "loadSessionHistory">;

export type SessionHistoryLoadResult =
  | { externalSessionId: string; status: "applied" }
  | { externalSessionId: string; status: "stale" }
  | { externalSessionId: string; status: "skipped" }
  | { externalSessionId: string; status: "failed"; error: unknown };

type AgentSessionHistoryTarget = AgentSessionIdentity & {
  systemPromptContext?: AgentSessionHistorySystemPromptContext;
};

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

type UseSelectedSessionHistoryLoaderArgs = {
  selectedSessionIdentity: AgentSessionIdentity | null;
  repoReadinessState: RepoRuntimeReadinessState;
  session: AgentSessionState | null;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<void>;
};

const INITIAL_SESSION_HISTORY_LIMIT = 600;

export const isSessionHistoryLoaded = (session: AgentSessionState): boolean =>
  session.historyLoadState === "loaded";

export const shouldLoadSelectedSessionHistory = ({
  repoReadinessState,
  session,
}: {
  repoReadinessState: RepoRuntimeReadinessState;
  session: AgentSessionState | null;
}): boolean => repoReadinessState === "ready" && session?.historyLoadState === "not_requested";

export const useSelectedSessionHistoryLoader = ({
  selectedSessionIdentity,
  repoReadinessState,
  session,
  loadAgentSessionHistory,
}: UseSelectedSessionHistoryLoaderArgs): void => {
  const shouldLoadHistory = shouldLoadSelectedSessionHistory({
    repoReadinessState,
    session,
  });

  useEffect(() => {
    if (selectedSessionIdentity === null || !shouldLoadHistory) {
      return;
    }

    void loadAgentSessionHistory(selectedSessionIdentity);
  }, [loadAgentSessionHistory, selectedSessionIdentity, shouldLoadHistory]);
};

const canStartSessionHistoryLoad = (session: AgentSessionState): boolean =>
  session.historyLoadState === "not_requested" || session.historyLoadState === "failed";

const claimSessionHistoryLoad = ({
  identity,
  readSessionSnapshot,
  updateSession,
}: {
  identity: AgentSessionIdentity;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
}): AgentSessionState | null => {
  const currentSession = readSessionSnapshot(identity);
  if (!currentSession || !canStartSessionHistoryLoad(currentSession)) {
    return null;
  }

  updateSession(
    currentSession,
    (current) =>
      canStartSessionHistoryLoad(current) ? { ...current, historyLoadState: "loading" } : current,
    { persist: false },
  );

  const claimedSession = readSessionSnapshot(currentSession);
  return claimedSession?.historyLoadState === "loading" ? claimedSession : null;
};

const releaseSessionHistoryLoad = ({
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

const failSessionHistoryLoad = ({
  session,
  updateSession,
}: {
  session: AgentSessionState;
  updateSession: UpdateSession;
}): void => {
  updateSession(
    session,
    (current) =>
      current.historyLoadState === "loading" ? { ...current, historyLoadState: "failed" } : current,
    { persist: false },
  );
};

const applySessionHistoryLoad = ({
  session,
  history,
  updateSession,
}: {
  session: AgentSessionState;
  history: AgentSessionHistoryMessage[];
  updateSession: UpdateSession;
}): void => {
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
};

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
  target,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  target: AgentSessionHistoryTarget;
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult> => {
  if (isStaleRepoOperation()) {
    return { externalSessionId: target.externalSessionId, status: "stale" };
  }

  const claimedSession = claimSessionHistoryLoad({
    identity: target,
    readSessionSnapshot,
    updateSession,
  });
  if (!claimedSession) {
    return { externalSessionId: target.externalSessionId, status: "skipped" };
  }

  try {
    const history = await adapter.loadSessionHistory({
      repoPath,
      runtimeKind: claimedSession.runtimeKind,
      workingDirectory: claimedSession.workingDirectory,
      externalSessionId: claimedSession.externalSessionId,
      ...(target.systemPromptContext ? { systemPromptContext: target.systemPromptContext } : {}),
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    });

    if (isStaleRepoOperation()) {
      releaseSessionHistoryLoad({ session: claimedSession, updateSession });
      return { externalSessionId: target.externalSessionId, status: "stale" };
    }

    applySessionHistoryLoad({ session: claimedSession, history, updateSession });
    return { externalSessionId: claimedSession.externalSessionId, status: "applied" };
  } catch (error) {
    if (isStaleRepoOperation()) {
      releaseSessionHistoryLoad({ session: claimedSession, updateSession });
      return { externalSessionId: target.externalSessionId, status: "stale" };
    }
    failSessionHistoryLoad({ session: claimedSession, updateSession });
    return { externalSessionId: target.externalSessionId, status: "failed", error };
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
) => Promise<SessionHistoryLoadResult>) => {
  return async (sessionIdentity: AgentSessionIdentity): Promise<SessionHistoryLoadResult> => {
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
      return { externalSessionId: sessionIdentity.externalSessionId, status: "stale" };
    }

    const session = readSessionSnapshot(sessionIdentity);
    if (!session) {
      throw new Error(
        `Cannot load history for unknown session '${sessionIdentity.externalSessionId}'.`,
      );
    }

    const systemPromptContext = await buildSessionHistorySystemPromptContext({
      workspaceId,
      tasks: taskRef.current,
      session,
      loadRepoPromptOverrides,
    });
    if (isStaleRepoOperation()) {
      return { externalSessionId: sessionIdentity.externalSessionId, status: "stale" };
    }

    return loadSessionHistoryIntoStore({
      repoPath,
      adapter,
      readSessionSnapshot,
      updateSession,
      target: {
        ...session,
        ...(systemPromptContext ? { systemPromptContext } : {}),
      },
      isStaleRepoOperation,
    });
  };
};
