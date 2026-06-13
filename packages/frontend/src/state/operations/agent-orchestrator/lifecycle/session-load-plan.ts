import type { AgentSessionRef } from "@openducktor/core";
import type {
  AgentSessionHistoryLoadPolicy,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import {
  buildRepoSessionReadModel,
  type RepoRuntimeSessionPresenceRead,
  type TaskSessionRecords,
} from "../session-read-model/repo-session-read-model";
import { getAgentSessionHistoryLoadState } from "../support/history-load-state";
import { someSessionMessage } from "../support/messages";
import { isSessionSystemPromptMessage } from "../support/session-prompt";
import type { AgentSessionHistoryTarget } from "./session-history-loader";

type SessionsById = Record<string, AgentSessionState>;

export type RepoSessionLoadPlan = {
  sessionsById: SessionsById;
  liveSessions: AgentSessionRef[];
  historySessions: AgentSessionHistoryTarget[];
};

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

const selectSessionHistorySessions = ({
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

export const buildRepoSessionLoadPlan = ({
  repoPath,
  tasks,
  currentSessionsById,
  runtimePresence,
  options,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  currentSessionsById: SessionsById;
  runtimePresence: RepoRuntimeSessionPresenceRead;
  options?: AgentSessionLoadOptions;
}): RepoSessionLoadPlan => {
  const readModel = buildRepoSessionReadModel({
    repoPath,
    tasks,
    currentSessionsById,
    runtimePresence,
  });
  const historySessions = selectSessionHistorySessions({
    sessionsById: readModel.sessionsById,
    liveSessions: readModel.liveSessions,
    ...(options ? { options } : {}),
  });

  return {
    sessionsById: readModel.sessionsById,
    liveSessions: readModel.liveSessions,
    historySessions,
  };
};
