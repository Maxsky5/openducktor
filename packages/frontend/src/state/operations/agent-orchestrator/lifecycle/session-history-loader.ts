import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import type {
  AgentChatMessage,
  AgentSessionHistoryLoadPolicy,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { getAgentSessionHistoryLoadState } from "../support/history-load-state";
import { mergeHistoryMessages } from "../support/history-message-merge";
import { createSessionMessagesState, someSessionMessage } from "../support/messages";
import { historyToChatMessages, historyToSessionContextUsage } from "../support/persistence";
import { isSessionSystemPromptMessage } from "../support/session-prompt";

type UpdateSession = (
  externalSessionId: string,
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
>;

const INITIAL_SESSION_HISTORY_LIMIT = 600;
const DEFAULT_SESSION_HISTORY_POLICY: AgentSessionHistoryLoadPolicy = "live_if_empty";

const shouldLoadLiveSessionHistory = (session: AgentSessionState | undefined): boolean => {
  if (!session) {
    return false;
  }

  const hasRuntimeTranscriptMessages = someSessionMessage(
    session,
    (message) => !isSessionSystemPromptMessage(message),
  );
  if (hasRuntimeTranscriptMessages) {
    return false;
  }

  return getAgentSessionHistoryLoadState(session) === "not_requested";
};

const resolveHistoryPolicy = (
  options: Pick<AgentSessionLoadOptions, "historyPolicy" | "targetExternalSessionId"> | undefined,
): AgentSessionHistoryLoadPolicy => {
  if (options?.historyPolicy) {
    return options.historyPolicy;
  }
  return options?.targetExternalSessionId ? "requested_only" : DEFAULT_SESSION_HISTORY_POLICY;
};

export const selectSessionHistoryTargets = ({
  sessionsById,
  liveSessions,
  options,
}: {
  sessionsById: Record<string, AgentSessionState>;
  liveSessions: AgentSessionRef[];
  options?: AgentSessionLoadOptions;
}): AgentSessionHistoryTarget[] => {
  const historyPolicy = resolveHistoryPolicy(options);
  if (historyPolicy === "none") {
    return [];
  }

  const targetExternalSessionId = options?.targetExternalSessionId?.trim();
  if (historyPolicy === "requested_only") {
    if (!targetExternalSessionId) {
      return [];
    }
    const session = sessionsById[targetExternalSessionId];
    if (!session) {
      throw new Error(`Cannot load history for unknown session '${targetExternalSessionId}'.`);
    }
    return [session];
  }

  const liveSessionIds = new Set(liveSessions.map((session) => session.externalSessionId));
  return Object.values(sessionsById).filter(
    (session) =>
      liveSessionIds.has(session.externalSessionId) && shouldLoadLiveSessionHistory(session),
  );
};

export const loadSessionHistorySnapshot = async ({
  repoPath,
  adapter,
  updateSession,
  session,
  headerMessages = [],
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  updateSession: UpdateSession;
  session: AgentSessionHistoryTarget;
  headerMessages?: AgentChatMessage[];
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult> => {
  if (isStaleRepoOperation()) {
    return { externalSessionId: session.externalSessionId, status: "stale" };
  }

  updateSession(
    session.externalSessionId,
    (current) => ({ ...current, historyLoadState: "loading" }),
    { persist: false },
  );

  try {
    const history = await adapter.loadSessionHistory({
      repoPath,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
      externalSessionId: session.externalSessionId,
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    });

    if (isStaleRepoOperation()) {
      return { externalSessionId: session.externalSessionId, status: "stale" };
    }

    const historyMessages = historyToChatMessages(history, {
      role: session.role,
      selectedModel: session.selectedModel,
    });
    const loadedMessages = createSessionMessagesState(
      session.externalSessionId,
      historyMessages.some(isSessionSystemPromptMessage)
        ? historyMessages
        : [...headerMessages, ...historyMessages],
    );
    const historyContextUsage = historyToSessionContextUsage(history);
    updateSession(
      session.externalSessionId,
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
    updateSession(
      session.externalSessionId,
      (current) => ({ ...current, historyLoadState: "failed" }),
      { persist: false },
    );
    return { externalSessionId: session.externalSessionId, status: "failed", error };
  }
};

export const loadSessionHistorySnapshots = async ({
  repoPath,
  adapter,
  updateSession,
  sessions,
  headerMessagesBySessionId,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  updateSession: UpdateSession;
  sessions: AgentSessionHistoryTarget[];
  headerMessagesBySessionId?: ReadonlyMap<string, AgentChatMessage[]>;
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult[]> =>
  Promise.all(
    sessions.map((session) => {
      const headerMessages = headerMessagesBySessionId?.get(session.externalSessionId);
      return loadSessionHistorySnapshot({
        repoPath,
        adapter,
        updateSession,
        session,
        ...(headerMessages ? { headerMessages } : {}),
        isStaleRepoOperation,
      });
    }),
  );
