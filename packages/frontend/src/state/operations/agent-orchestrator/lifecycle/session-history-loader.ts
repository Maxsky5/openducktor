import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { mergeHistoryMessages } from "../support/history-message-merge";
import { createSessionMessagesState } from "../support/messages";
import { normalizePersistedSelection } from "../support/models";
import { historyToChatMessages, historyToSessionContextUsage } from "../support/persistence";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";

type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type SessionHistoryLoaderAdapter = Pick<AgentEnginePort, "loadSessionHistory"> & {
  loadSessionTodos?: AgentEnginePort["loadSessionTodos"];
};

export type SessionHistoryLoadResult =
  | { externalSessionId: string; status: "applied" }
  | { externalSessionId: string; status: "stale" }
  | { externalSessionId: string; status: "failed"; error: unknown };

const INITIAL_SESSION_HISTORY_LIMIT = 600;

const findRecord = (
  records: AgentSessionRecord[],
  externalSessionId: string,
): AgentSessionRecord | null =>
  records.find((record) => record.externalSessionId === externalSessionId) ?? null;

export const loadSessionHistorySnapshot = async ({
  repoPath,
  adapter,
  updateSession,
  record,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  updateSession: UpdateSession;
  record: AgentSessionRecord;
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult> => {
  if (isStaleRepoOperation()) {
    return { externalSessionId: record.externalSessionId, status: "stale" };
  }

  const runtimeKind: RuntimeKind = readPersistedRuntimeKind(record);
  const selectedModel = normalizePersistedSelection(record.selectedModel);

  updateSession(
    record.externalSessionId,
    (current) => ({ ...current, historyLoadState: "loading" }),
    { persist: false },
  );

  try {
    const [history, todos] = await Promise.all([
      adapter.loadSessionHistory({
        repoPath,
        runtimeKind,
        workingDirectory: record.workingDirectory,
        externalSessionId: record.externalSessionId,
        limit: INITIAL_SESSION_HISTORY_LIMIT,
      }),
      adapter.loadSessionTodos
        ? adapter.loadSessionTodos({
            repoPath,
            runtimeKind,
            workingDirectory: record.workingDirectory,
            externalSessionId: record.externalSessionId,
          })
        : Promise.resolve([]),
    ]);

    if (isStaleRepoOperation()) {
      return { externalSessionId: record.externalSessionId, status: "stale" };
    }

    const loadedMessages = createSessionMessagesState(record.externalSessionId, [
      ...historyToChatMessages(history, { role: record.role, selectedModel }),
    ]);
    const historyContextUsage = historyToSessionContextUsage(history);
    updateSession(
      record.externalSessionId,
      (current) => ({
        ...current,
        runtimeKind,
        workingDirectory: record.workingDirectory,
        historyLoadState: "loaded",
        todos,
        contextUsage: current.contextUsage ?? historyContextUsage,
        messages: mergeHistoryMessages(current.externalSessionId, loadedMessages, current.messages),
      }),
      { persist: false },
    );
    return { externalSessionId: record.externalSessionId, status: "applied" };
  } catch (error) {
    if (isStaleRepoOperation()) {
      return { externalSessionId: record.externalSessionId, status: "stale" };
    }
    updateSession(
      record.externalSessionId,
      (current) => ({ ...current, historyLoadState: "failed" }),
      { persist: false },
    );
    return { externalSessionId: record.externalSessionId, status: "failed", error };
  }
};

export const loadRequestedSessionHistorySnapshot = async ({
  repoPath,
  adapter,
  updateSession,
  records,
  externalSessionId,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  updateSession: UpdateSession;
  records: AgentSessionRecord[];
  externalSessionId: string;
  isStaleRepoOperation: () => boolean;
}): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }

  const record = findRecord(records, externalSessionId);
  if (!record) {
    if (isStaleRepoOperation()) {
      return;
    }
    updateSession(externalSessionId, (current) => ({ ...current, historyLoadState: "failed" }), {
      persist: false,
    });
    throw new Error(`Cannot load history for unknown session '${externalSessionId}'.`);
  }

  const result = await loadSessionHistorySnapshot({
    repoPath,
    adapter,
    updateSession,
    record,
    isStaleRepoOperation,
  });
  if (result.status === "failed") {
    throw result.error;
  }
};

export const loadSessionHistorySnapshots = async ({
  repoPath,
  adapter,
  updateSession,
  records,
  isStaleRepoOperation,
}: {
  repoPath: string;
  adapter: SessionHistoryLoaderAdapter;
  updateSession: UpdateSession;
  records: AgentSessionRecord[];
  isStaleRepoOperation: () => boolean;
}): Promise<SessionHistoryLoadResult[]> =>
  Promise.all(
    records.map((record) =>
      loadSessionHistorySnapshot({
        repoPath,
        adapter,
        updateSession,
        record,
        isStaleRepoOperation,
      }),
    ),
  );
