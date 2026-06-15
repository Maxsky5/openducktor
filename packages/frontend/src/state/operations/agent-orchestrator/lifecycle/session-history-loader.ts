import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionHistorySystemPromptContext } from "@openducktor/core";
import type { MutableRefObject } from "react";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { createRepoStaleGuard } from "../support/core";
import { mergeHistoryMessages } from "../support/history-message-merge";
import { createSessionMessagesState } from "../support/messages";
import { historyToChatMessages, historyToSessionContextUsage } from "../support/persistence";
import { loadSessionPromptContext } from "../support/session-prompt";
import type { SessionRepoReadinessState } from "./session-view-lifecycle";

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
  activeWorkspace: ActiveWorkspace | null;
  adapter: SessionHistoryLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  taskRef: MutableRefObject<TaskCard[]>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

const INITIAL_SESSION_HISTORY_LIMIT = 600;

const shouldAutoLoadSelectedSessionHistory = (session: AgentSessionState): boolean =>
  session.historyLoadState === "not_requested";

const canStartSessionHistoryLoad = (session: AgentSessionState): boolean =>
  session.historyLoadState === "not_requested" || session.historyLoadState === "failed";

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
  return shouldAutoLoadSelectedSessionHistory(session);
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

  const currentSession = readSessionSnapshot(target);
  if (!currentSession || !canStartSessionHistoryLoad(currentSession)) {
    return { externalSessionId: target.externalSessionId, status: "skipped" };
  }

  updateSession(
    currentSession,
    (current) => {
      if (!canStartSessionHistoryLoad(current)) {
        return current;
      }
      return { ...current, historyLoadState: "loading" };
    },
    {
      persist: false,
    },
  );

  const claimedSession = readSessionSnapshot(currentSession);
  if (claimedSession?.historyLoadState !== "loading") {
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
      releaseStaleHistoryLoad({ session: claimedSession, updateSession });
      return { externalSessionId: target.externalSessionId, status: "stale" };
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
      return { externalSessionId: target.externalSessionId, status: "stale" };
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
    return { externalSessionId: target.externalSessionId, status: "failed", error };
  }
};

export const createLoadAgentSessionHistory = ({
  activeWorkspace,
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

    const session = readSessionSnapshot(sessionIdentity);
    if (!session) {
      throw new Error(
        `Cannot load history for unknown session '${sessionIdentity.externalSessionId}'.`,
      );
    }

    const systemPromptContext = await buildSessionHistorySystemPromptContext({
      workspaceId: activeWorkspace.workspaceId,
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
