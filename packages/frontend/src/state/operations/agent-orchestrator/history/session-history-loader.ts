import type { SessionHistoryFailure } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";
import type { MutableRefObject } from "react";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import {
  type LoadSettingsSnapshotForRuntimePolicy,
  resolveRuntimeSessionContextRef,
} from "../support/session-runtime-policy";
import { requireBoundSessionAssociation } from "../support/session-runtime-ref";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import { hasLoadedSessionHistory } from "../transcript/session-transcript-content";
import {
  abandonSessionHistoryLoad,
  claimSessionHistoryLoad,
  failSessionHistoryLoad,
} from "./session-history-load-policy";
import type { SessionHistoryReadGeneration } from "./session-history-read-generation";
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
  historyReadGeneration: SessionHistoryReadGeneration;
};

const SESSION_HISTORY_LOAD_LIMIT = 600;

type LoadSessionHistoryIntoStoreArgs = {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  identity: AgentSessionIdentity;
  loadSettingsSnapshot?: LoadSettingsSnapshotForRuntimePolicy;
  loadSystemPromptContext?: LoadSessionHistorySystemPromptContext;
  isStaleRepoOperation: () => boolean;
  historyReadGeneration: SessionHistoryReadGeneration;
};

export const loadSessionHistoryIntoStore = async ({
  repoPath,
  adapter,
  readSessionSnapshot,
  updateSession,
  identity,
  loadSettingsSnapshot,
  loadSystemPromptContext,
  isStaleRepoOperation,
  historyReadGeneration,
}: LoadSessionHistoryIntoStoreArgs): Promise<AgentSessionState | null> => {
  if (isStaleRepoOperation()) {
    return null;
  }

  const currentSession = readSessionSnapshot(identity);
  if (currentSession) {
    requireBoundSessionAssociation(currentSession, "load history");
  }

  let claimedLoad = false;
  updateSession(identity, (current) => {
    const claimed = claimSessionHistoryLoad(current);
    claimedLoad = claimed !== null;
    return claimed ?? current;
  });
  const loadingSession = readSessionSnapshot(identity);
  if (!loadingSession || !claimedLoad) return loadingSession;

  const readToken = historyReadGeneration.begin(identity);
  const isSupersededRead = (): boolean =>
    !historyReadGeneration.isLatest(identity, readToken) ||
    !["loading", "refreshing"].includes(readSessionSnapshot(identity)?.historyLoadState ?? "");
  const finishStaleHistoryLoad = (): null => {
    if (!isSupersededRead()) {
      updateSession(identity, abandonSessionHistoryLoad);
    }
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
    if (isSupersededRead()) {
      return readSessionSnapshot(identity);
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
    if (isSupersededRead()) {
      return readSessionSnapshot(identity);
    }

    const historyInput: Parameters<typeof adapter.loadSessionHistory>[0] = {
      ...sessionRef,
      limit: SESSION_HISTORY_LOAD_LIMIT,
    };
    if (systemPromptContext) {
      historyInput.systemPromptContext = systemPromptContext;
    }
    const sessionAtReadStart = readSessionSnapshot(identity);
    const messagesAtReadStart = sessionAtReadStart?.messages;
    const questionsAtReadStart = sessionAtReadStart?.pendingQuestions;
    const history = await adapter.loadSessionHistory(historyInput);
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }
    if (isSupersededRead()) {
      return readSessionSnapshot(identity);
    }

    updateSession(identity, (current) =>
      applyLoadedSessionHistory(current, history, messagesAtReadStart, questionsAtReadStart),
    );
    return readSessionSnapshot(identity);
  } catch (error) {
    if (isStaleRepoOperation()) {
      return finishStaleHistoryLoad();
    }
    if (isSupersededRead()) {
      return readSessionSnapshot(identity);
    }
    updateSession(identity, (session) =>
      failSessionHistoryLoad(session, sessionHistoryFailureFromError(error)),
    );
    const failedSession = readSessionSnapshot(identity);
    return failedSession && hasLoadedSessionHistory(failedSession) ? failedSession : null;
  } finally {
    historyReadGeneration.finish(identity, readToken);
  }
};

export const createLoadAgentSessionHistory =
  ({
    workspaceRepoPath,
    adapter,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    readSessionSnapshot,
    updateSession,
    loadSystemPromptContext,
    loadSettingsSnapshot,
    historyReadGeneration,
  }: CreateLoadAgentSessionHistoryArgs): ((
    identity: AgentSessionIdentity,
  ) => Promise<AgentSessionState | null>) =>
  async (identity) => {
    if (!readSessionSnapshot(identity)) {
      throw new Error(`Cannot load history for unknown session '${identity.externalSessionId}'.`);
    }
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    const repoEpochAtStart = repoEpochRef.current;
    const input: LoadSessionHistoryIntoStoreArgs = {
      repoPath,
      adapter,
      readSessionSnapshot,
      updateSession,
      identity,
      loadSystemPromptContext,
      historyReadGeneration,
      isStaleRepoOperation: () =>
        repoEpochRef.current !== repoEpochAtStart ||
        currentWorkspaceRepoPathRef.current !== repoPath,
    };
    if (loadSettingsSnapshot) input.loadSettingsSnapshot = loadSettingsSnapshot;
    return loadSessionHistoryIntoStore(input);
  };

const sessionHistoryFailureFromError = (cause: unknown): SessionHistoryFailure => {
  if (cause instanceof HostInvokeError && cause.failure?.kind === "session_history") {
    return cause.failure.sessionHistoryFailure;
  }
  if (cause instanceof HostInvokeError && cause.failure?.kind === "runtime_query") {
    const failure = cause.failure.runtimeQueryFailure;
    return (
      failure.sessionHistoryFailure ?? {
        code: failure.code === "invalid_runtime_response" ? failure.code : "request_failed",
        summary: failure.summary,
        detail: failure.detail,
      }
    );
  }
  return {
    code: "request_failed",
    summary: "Conversation history could not be loaded.",
    detail: cause instanceof Error ? cause.message : String(cause),
  };
};
