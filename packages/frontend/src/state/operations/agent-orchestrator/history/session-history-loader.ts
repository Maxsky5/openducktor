import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionHistorySystemPromptContext } from "@openducktor/core";
import type { MutableRefObject } from "react";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { createRepoStaleGuard } from "../support/core";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import { loadSessionPromptContext } from "../support/session-prompt";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";

type ReadSessionSnapshot = (identity: AgentSessionIdentity) => AgentSessionState | null;

export type SessionHistoryLoaderAdapter = Pick<AgentEnginePort, "loadSessionHistory">;

export type SessionHistoryLoadResult =
  | { externalSessionId: string; status: "applied" }
  | { externalSessionId: string; status: "stale" }
  | { externalSessionId: string; status: "skipped" }
  | { externalSessionId: string; status: "failed"; error: unknown };

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

  const claimedSession = updateSession(currentSession, (current) =>
    canStartSessionHistoryLoad(current) ? { ...current, historyLoadState: "loading" } : current,
  );

  return claimedSession?.historyLoadState === "loading" ? claimedSession : null;
};

const settleClaimedSessionHistoryLoad = (
  session: AgentSessionState,
  updateSession: UpdateSession,
  historyLoadState: Extract<AgentSessionState["historyLoadState"], "not_requested" | "failed">,
): void => {
  updateSession(session, (current) =>
    current.historyLoadState === "loading"
      ? {
          ...current,
          historyLoadState,
        }
      : current,
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
}): Promise<SessionHistoryLoadResult> => {
  const externalSessionId = identity.externalSessionId;
  if (isStaleRepoOperation()) {
    return { externalSessionId, status: "stale" };
  }

  const claimedSession = claimSessionHistoryLoad({
    identity,
    readSessionSnapshot,
    updateSession,
  });
  if (!claimedSession) {
    return { externalSessionId, status: "skipped" };
  }

  const finishStaleHistoryLoad = (): SessionHistoryLoadResult => {
    settleClaimedSessionHistoryLoad(claimedSession, updateSession, "not_requested");
    return { externalSessionId, status: "stale" };
  };

  try {
    const systemPromptContext = await loadSystemPromptContext?.(claimedSession);

    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    const history = await adapter.loadSessionHistory({
      ...toRuntimeSessionRef(repoPath, claimedSession),
      ...(systemPromptContext ? { systemPromptContext } : {}),
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    });

    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    updateSession(claimedSession, (current) => applyLoadedSessionHistory(current, history));
    return { externalSessionId: claimedSession.externalSessionId, status: "applied" };
  } catch (error) {
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }
    settleClaimedSessionHistoryLoad(claimedSession, updateSession, "failed");
    return { externalSessionId: identity.externalSessionId, status: "failed", error };
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
