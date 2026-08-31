import type { SessionHistoryFailure } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";
import type { MutableRefObject } from "react";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import type { LoadSettingsSnapshotForRuntimePolicy } from "../support/session-runtime-policy";
import { resolveRuntimeSessionContextRef } from "../support/session-runtime-policy";
import { requireBoundSessionAssociation } from "../support/session-runtime-ref";
import {
  requestedSessionHistoryLoadPolicy,
  type SessionHistoryLoadPolicy,
  selectedSessionBaselineHistoryLoadPolicy,
  transcriptGapRecoveryHistoryLoadPolicy,
} from "./session-history-load-policy";
import type { LoadSessionHistorySystemPromptContext } from "./workflow-session-history-policy";

export type SessionHistoryLoaderAdapter = Pick<AgentEnginePort, "loadSessionHistory">;

type CreateLoadAgentSessionHistoryArgs = {
  workspaceRepoPath: string | null;
  adapter: SessionHistoryLoaderAdapter;
  repoEpochRef: MutableRefObject<number>;
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  loadSystemPromptContext: LoadSessionHistorySystemPromptContext;
  loadSettingsSnapshot?: LoadSettingsSnapshotForRuntimePolicy;
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

  if (!policy.canClaimLoad(currentSession)) {
    return { session: currentSession, claimedLoad: false };
  }

  let claimedLoad = false;
  const loadingSession = updateSession(identity, (current) => {
    if (!policy.canClaimLoad(current)) {
      claimedLoad = false;
      return current;
    }

    if (current.historyLoadState === "loading") {
      return current;
    }

    claimedLoad = true;
    return { ...current, historyLoadState: "loading", historyLoadFailure: null };
  });

  return { session: loadingSession, claimedLoad: loadingSession !== null && claimedLoad };
};

const resetLoadingSessionHistory = (
  identity: AgentSessionIdentity,
  updateSession: UpdateSession,
  policy: SessionHistoryLoadPolicy,
): AgentSessionState | null => updateSession(identity, policy.abandonLoad);

const failSessionHistoryLoad = (
  identity: AgentSessionIdentity,
  updateSession: UpdateSession,
  policy: SessionHistoryLoadPolicy,
  failure: SessionHistoryFailure,
): AgentSessionState | null =>
  updateSession(identity, (session) => policy.failLoad(session, failure));

const sessionHistoryFailureFromError = (cause: unknown): SessionHistoryFailure => {
  if (cause instanceof HostInvokeError && cause.failure?.kind === "session_history") {
    return cause.failure.sessionHistoryFailure;
  }
  return {
    code: "request_failed",
    summary: "Conversation history could not be loaded.",
    detail: cause instanceof Error ? cause.message : String(cause),
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
  isStaleRepoOperation: () => boolean;
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
  isStaleRepoOperation,
}: LoadSessionHistoryIntoStoreArgs & {
  policy: SessionHistoryLoadPolicy;
}): Promise<AgentSessionState | null> => {
  if (isStaleRepoOperation()) {
    return null;
  }

  const currentSession = readSessionSnapshot(identity);
  if (currentSession) {
    requireBoundSessionAssociation(currentSession, "load history");
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
    resetLoadingSessionHistory(identity, updateSession, policy);
    return null;
  };

  try {
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    const systemPromptContext = await loadSystemPromptContext?.(loadingSession);
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    const sessionForHistory = readSessionSnapshot(identity);
    if (!sessionForHistory) {
      return finishStaleHistoryLoad();
    }
    const sessionRef = await resolveRuntimeSessionContextRef(
      repoPath,
      {
        identity: sessionForHistory,
        sessionAssociation: sessionForHistory.sessionAssociation,
        selectedModel: sessionForHistory.selectedModel,
      },
      loadSettingsSnapshot ??
        (() => {
          throw new Error(
            "Settings snapshot loader is required to resolve session runtime policy.",
          );
        }),
    );
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    const historyInput: Parameters<typeof adapter.loadSessionHistory>[0] = {
      ...sessionRef,
      limit: SESSION_HISTORY_LOAD_LIMIT,
    };
    if (systemPromptContext) {
      historyInput.systemPromptContext = systemPromptContext;
    }
    const history = await adapter.loadSessionHistory(historyInput);
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }

    return updateSession(identity, (current) => policy.applyLoadedHistory(current, history));
  } catch (error) {
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }
    const failedSession = failSessionHistoryLoad(
      identity,
      updateSession,
      policy,
      sessionHistoryFailureFromError(error),
    );
    if (policy.propagateFailure) {
      throw error;
    }
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

export const reloadSessionHistoryIntoStore = async (
  args: LoadSessionHistoryIntoStoreArgs,
): Promise<AgentSessionState | null> =>
  loadSessionHistoryIntoStoreWithPolicy({
    ...args,
    policy: transcriptGapRecoveryHistoryLoadPolicy,
  });

const createLoadSessionHistoryWithPolicy = ({
  workspaceRepoPath,
  adapter,
  repoEpochRef,
  currentWorkspaceRepoPathRef,
  readSessionSnapshot,
  updateSession,
  loadSystemPromptContext,
  loadSettingsSnapshot,
  policy,
}: CreateLoadAgentSessionHistoryArgs & {
  policy: SessionHistoryLoadPolicy;
}): ((sessionIdentity: AgentSessionIdentity) => Promise<AgentSessionState | null>) => {
  return async (sessionIdentity: AgentSessionIdentity): Promise<AgentSessionState | null> => {
    const session = readSessionSnapshot(sessionIdentity);
    if (!session) {
      throw new Error(
        `Cannot load history for unknown session '${sessionIdentity.externalSessionId}'.`,
      );
    }
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    const repoEpochAtStart = repoEpochRef.current;
    const isStaleRepoOperation = (): boolean =>
      repoEpochRef.current !== repoEpochAtStart || currentWorkspaceRepoPathRef.current !== repoPath;
    if (isStaleRepoOperation()) {
      return null;
    }

    const input: Parameters<typeof loadSessionHistoryIntoStoreWithPolicy>[0] = {
      repoPath,
      adapter,
      readSessionSnapshot,
      updateSession,
      identity: sessionIdentity,
      policy,
      loadSystemPromptContext,
      isStaleRepoOperation,
    };
    if (loadSettingsSnapshot) {
      input.loadSettingsSnapshot = loadSettingsSnapshot;
    }
    return loadSessionHistoryIntoStoreWithPolicy(input);
  };
};

export const createLoadAgentSessionHistory = (
  args: CreateLoadAgentSessionHistoryArgs,
): ((sessionIdentity: AgentSessionIdentity) => Promise<AgentSessionState | null>) =>
  createLoadSessionHistoryWithPolicy({
    ...args,
    policy: requestedSessionHistoryLoadPolicy,
  });

export const createLoadSelectedSessionBaselineHistory = (
  args: CreateLoadAgentSessionHistoryArgs,
): ((sessionIdentity: AgentSessionIdentity) => Promise<AgentSessionState | null>) =>
  createLoadSessionHistoryWithPolicy({
    ...args,
    policy: selectedSessionBaselineHistoryLoadPolicy,
  });

export const createReloadAgentSessionHistory = (
  args: CreateLoadAgentSessionHistoryArgs,
): ((sessionIdentity: AgentSessionIdentity) => Promise<AgentSessionState | null>) =>
  createLoadSessionHistoryWithPolicy({
    ...args,
    policy: transcriptGapRecoveryHistoryLoadPolicy,
  });
