import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import type {
  AgentSessionHistoryLoadPolicy,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import {
  buildRepoSessionReadModel,
  type RepoSessionPresenceRead,
  type TaskSessionRecords,
} from "../session-read-model/repo-session-read-model";
import { getAgentSessionHistoryLoadState } from "../support/history-load-state";
import { someSessionMessage } from "../support/messages";
import { isSessionSystemPromptMessage } from "../support/session-prompt";

type SessionsById = Record<string, AgentSessionState>;

export type RepoSessionLoadPlan = {
  sessionsById: SessionsById;
  liveSessions: AgentSessionRef[];
  historyRecords: AgentSessionRecord[];
};

const DEFAULT_SESSION_HISTORY_POLICY: AgentSessionHistoryLoadPolicy = "live_if_empty";

const findRecord = (
  records: AgentSessionRecord[],
  externalSessionId: string,
): AgentSessionRecord | null =>
  records.find((record) => record.externalSessionId === externalSessionId) ?? null;

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

const selectSessionHistoryRecords = ({
  records,
  sessionsById,
  liveSessions,
  options,
}: {
  records: AgentSessionRecord[];
  sessionsById: Record<string, AgentSessionState>;
  liveSessions: AgentSessionRef[];
  options?: AgentSessionLoadOptions;
}): AgentSessionRecord[] => {
  const historyPolicy = resolveHistoryPolicy(options);
  if (historyPolicy === "none") {
    return [];
  }

  const targetExternalSessionId = options?.targetExternalSessionId?.trim();
  if (historyPolicy === "requested_only") {
    if (!targetExternalSessionId) {
      return [];
    }
    const record = findRecord(records, targetExternalSessionId);
    if (!record) {
      throw new Error(`Cannot load history for unknown session '${targetExternalSessionId}'.`);
    }
    return [record];
  }

  const liveSessionIds = new Set(liveSessions.map((session) => session.externalSessionId));
  return records.filter(
    (record) =>
      liveSessionIds.has(record.externalSessionId) &&
      shouldLoadLiveSessionHistory(sessionsById[record.externalSessionId]),
  );
};

export const buildRepoSessionLoadPlan = ({
  repoPath,
  tasks,
  currentSessionsById,
  presence,
  options,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  currentSessionsById: SessionsById;
  presence: RepoSessionPresenceRead;
  options?: AgentSessionLoadOptions;
}): RepoSessionLoadPlan => {
  const readModel = buildRepoSessionReadModel({
    repoPath,
    tasks,
    currentSessionsById,
    presence,
  });
  const historyRecords = selectSessionHistoryRecords({
    records: tasks.flatMap((task) => task.agentSessions ?? []),
    sessionsById: readModel.sessionsById,
    liveSessions: readModel.liveSessions,
    ...(options ? { options } : {}),
  });

  return {
    sessionsById: readModel.sessionsById,
    liveSessions: readModel.liveSessions,
    historyRecords,
  };
};
