import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentSessionHistorySystemPromptContext,
  AgentSessionRuntimeRef,
} from "@openducktor/core";
import type { MutableRefObject } from "react";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { createRepoStaleGuard } from "../support/core";
import type { ReadSessionSnapshot } from "../support/session-invariants";
import { loadSessionPromptContext } from "../support/session-prompt";
import type { LoadSettingsSnapshotForRuntimePolicy } from "../support/session-runtime-policy";
import { resolveRuntimeSessionContextRef } from "../support/session-runtime-policy";
import type { ObserveAgentSession } from "../support/session-runtime-ref";
import {
  requestedSessionHistoryLoadPolicy,
  type SessionHistoryLoadPolicy,
  selectedSessionBaselineHistoryLoadPolicy,
} from "./session-history-load-policy";

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
  loadSettingsSnapshot?: LoadSettingsSnapshotForRuntimePolicy;
  observeAgentSession?: ObserveAgentSession;
};

type SessionHistoryLoadClaim = {
  session: AgentSessionState | null;
  claimedLoad: boolean;
};

const SESSION_HISTORY_LOAD_LIMIT = 600;

const markSessionHistoryLoading = ({
  identity,
  policy,
  readSessionSnapshot,
  updateSession,
}: {
  identity: AgentSessionIdentity;
  policy: SessionHistoryLoadPolicy;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
}): SessionHistoryLoadClaim => {
  const currentSession = readSessionSnapshot(identity);
  if (!currentSession) {
    return { session: null, claimedLoad: false };
  }

  if (currentSession.historyLoadState === "loaded") {
    return { session: currentSession, claimedLoad: false };
  }

  if (!policy.canClaimLoad(currentSession)) {
    return { session: currentSession, claimedLoad: false };
  }

  let claimedLoad = false;
  const loadingSession = updateSession(identity, (current) => {
    if (current.historyLoadState === "loaded" || !policy.canClaimLoad(current)) {
      claimedLoad = false;
      return current;
    }

    if (current.historyLoadState === "loading") {
      return current;
    }

    claimedLoad = true;
    return { ...current, historyLoadState: "loading" };
  });

  return { session: loadingSession, claimedLoad: loadingSession !== null && claimedLoad };
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

type LoadSessionHistoryIntoStoreArgs = {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  identity: AgentSessionIdentity;
  loadSettingsSnapshot?: LoadSettingsSnapshotForRuntimePolicy;
  loadSystemPromptContext?: LoadSessionHistorySystemPromptContext;
  observeAgentSession?: ObserveAgentSession;
  isStaleRepoOperation: () => boolean;
};

const observeSelectedSessionWithoutBlockingHistory = (
  observeAgentSession: ObserveAgentSession | undefined,
  sessionRef: AgentSessionRuntimeRef,
): void => {
  if (!observeAgentSession) {
    return;
  }

  runOrchestratorSideEffect("selected-session-observe", observeAgentSession(sessionRef), {
    tags: {
      externalSessionId: sessionRef.externalSessionId,
      runtimeKind: sessionRef.runtimeKind,
      workingDirectory: sessionRef.workingDirectory,
    },
  });
};

const loadSessionHistoryIntoStoreWithPolicy = async ({
  repoPath,
  adapter,
  readSessionSnapshot,
  updateSession,
  identity,
  policy,
  loadSettingsSnapshot,
  loadSystemPromptContext,
  observeAgentSession,
  isStaleRepoOperation,
}: LoadSessionHistoryIntoStoreArgs & {
  policy: SessionHistoryLoadPolicy;
}): Promise<AgentSessionState | null> => {
  if (isStaleRepoOperation()) {
    return null;
  }

  const loadClaim = markSessionHistoryLoading({
    identity,
    policy,
    readSessionSnapshot,
    updateSession,
  });
  if (!loadClaim.session) {
    return null;
  }

  if (!loadClaim.claimedLoad) {
    return loadClaim.session;
  }

  const loadingSession = loadClaim.session;
  const finishStaleHistoryLoad = (): null => {
    resetLoadingSessionHistory(identity, updateSession);
    return null;
  };

  try {
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    const systemPromptContext = await loadSystemPromptContext?.(loadingSession);

    if (!isStaleRepoOperation()) {
      const sessionForHistory = readSessionSnapshot(identity);
      if (!sessionForHistory) {
        return finishStaleHistoryLoad();
      }
      const sessionRef = await resolveRuntimeSessionContextRef(
        repoPath,
        sessionForHistory,
        loadSettingsSnapshot ??
          (() => {
            throw new Error(
              "Settings snapshot loader is required to resolve session runtime policy.",
            );
          }),
      );
      observeSelectedSessionWithoutBlockingHistory(observeAgentSession, sessionRef);
      if (isStaleRepoOperation()) {
        return finishStaleHistoryLoad();
      }

      const history = await adapter.loadSessionHistory({
        ...sessionRef,
        ...(systemPromptContext ? { systemPromptContext } : {}),
        limit: SESSION_HISTORY_LOAD_LIMIT,
      });

      if (!isStaleRepoOperation()) {
        return updateSession(identity, (current) => policy.applyLoadedHistory(current, history));
      }
    }

    return finishStaleHistoryLoad();
  } catch {
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }
    const failedSession = failSessionHistoryLoad(identity, updateSession);
    return failedSession?.historyLoadState === "loaded" ? failedSession : null;
  }
};

export const loadSessionHistoryIntoStore = async (
  args: LoadSessionHistoryIntoStoreArgs,
): Promise<AgentSessionState | null> =>
  loadSessionHistoryIntoStoreWithPolicy({
    ...args,
    policy: requestedSessionHistoryLoadPolicy,
  });

export const loadSelectedSessionBaselineHistoryIntoStore = async (
  args: LoadSessionHistoryIntoStoreArgs,
): Promise<AgentSessionState | null> =>
  loadSessionHistoryIntoStoreWithPolicy({
    ...args,
    policy: selectedSessionBaselineHistoryLoadPolicy,
  });

const createLoadSessionHistoryWithPolicy = ({
  workspaceRepoPath,
  workspaceId,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  readSessionSnapshot,
  updateSession,
  taskRef,
  loadRepoPromptOverrides,
  loadSettingsSnapshot,
  observeAgentSession,
  policy,
}: CreateLoadAgentSessionHistoryArgs & {
  policy: SessionHistoryLoadPolicy;
}): ((sessionIdentity: AgentSessionIdentity) => Promise<AgentSessionState | null>) => {
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

    return loadSessionHistoryIntoStoreWithPolicy({
      repoPath,
      adapter,
      readSessionSnapshot,
      updateSession,
      identity: sessionIdentity,
      policy,
      loadSystemPromptContext: (session) =>
        buildSessionHistorySystemPromptContext({
          workspaceId,
          tasks: taskRef.current,
          session,
          loadRepoPromptOverrides,
        }),
      ...(loadSettingsSnapshot ? { loadSettingsSnapshot } : {}),
      ...(observeAgentSession ? { observeAgentSession } : {}),
      isStaleRepoOperation,
    });
  };
};

export const createLoadAgentSessionHistory = (
  args: CreateLoadAgentSessionHistoryArgs,
): ((sessionIdentity: AgentSessionIdentity) => Promise<AgentSessionState | null>) => {
  const { observeAgentSession: _observeAgentSession, ...loaderArgs } = args;
  return createLoadSessionHistoryWithPolicy({
    ...loaderArgs,
    policy: requestedSessionHistoryLoadPolicy,
  });
};

export const createLoadSelectedSessionBaselineHistory = (
  args: CreateLoadAgentSessionHistoryArgs,
): ((sessionIdentity: AgentSessionIdentity) => Promise<AgentSessionState | null>) =>
  createLoadSessionHistoryWithPolicy({
    ...args,
    policy: selectedSessionBaselineHistoryLoadPolicy,
  });
