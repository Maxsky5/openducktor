import type { AgentSessionRecord, RepoPromptOverrides } from "@openducktor/contracts";
import type { AgentSessionPurpose, AgentSessionState } from "@/types/agent-orchestrator";
import { DEFAULT_AGENT_SESSION_HISTORY_HYDRATION_STATE } from "../support/history-hydration";
import { mergeModelSelection } from "../support/models";
import { fromPersistedSessionRecord } from "../support/persistence";
import {
  isTranscriptAgentSession,
  isWorkflowAgentSession,
  resolveAgentSessionPurposeForLoad,
} from "../support/session-purpose";
import { EMPTY_PROMPT_OVERRIDES } from "./load-sessions-stage-constants";
import type {
  PersistedSessionMergeStageInput,
  PersistedSessionMergeStageOutput,
} from "./load-sessions-stages";

const mergePersistedSessionRecord = (
  current: AgentSessionState,
  record: AgentSessionRecord,
  taskId: string,
  repoPath: string,
  promptOverrides: RepoPromptOverrides,
  purpose: AgentSessionPurpose,
  shouldPreserveTranscriptSession: boolean,
): AgentSessionState => {
  if (shouldPreserveTranscriptSession && isTranscriptAgentSession(current)) {
    return current;
  }

  const persisted = fromPersistedSessionRecord(record, taskId, repoPath);
  const currentWorkingDirectory = current.workingDirectory.trim();
  const shouldKeepLiveWorkingDirectory =
    current.runtimeId !== null && currentWorkingDirectory.length > 0;
  return {
    ...current,
    purpose,
    repoPath: persisted.repoPath,
    externalSessionId: persisted.externalSessionId,
    taskId: persisted.taskId,
    role: persisted.role,
    startedAt: persisted.startedAt,
    workingDirectory: shouldKeepLiveWorkingDirectory
      ? current.workingDirectory
      : persisted.workingDirectory,
    pendingApprovals: current.pendingApprovals,
    pendingQuestions: current.pendingQuestions,
    selectedModel: mergeModelSelection(current.selectedModel, persisted.selectedModel ?? undefined),
    historyHydrationState:
      current.historyHydrationState ??
      persisted.historyHydrationState ??
      DEFAULT_AGENT_SESSION_HISTORY_HYDRATION_STATE,
    runtimeRecoveryState: current.runtimeRecoveryState ?? persisted.runtimeRecoveryState ?? "idle",
    promptOverrides,
  };
};

const toRequestedHistoryRecordFromSession = (
  session: AgentSessionState,
): AgentSessionRecord | null => {
  if (!isWorkflowAgentSession(session)) {
    return null;
  }
  const runtimeKind = session.runtimeKind ?? null;
  if (!runtimeKind) {
    return null;
  }

  return {
    externalSessionId: session.externalSessionId,
    role: session.role,
    startedAt: session.startedAt,
    workingDirectory: session.workingDirectory,
    runtimeKind,
    selectedModel: session.selectedModel
      ? {
          ...session.selectedModel,
          runtimeKind,
        }
      : null,
  };
};

const mergePersistedSessionRecords = ({
  current,
  persistedRecords,
  intent,
}: {
  current: Record<string, AgentSessionState>;
  persistedRecords: AgentSessionRecord[];
  intent: PersistedSessionMergeStageInput["intent"];
}): Record<string, AgentSessionState> => {
  const next = { ...current };
  for (const record of persistedRecords) {
    const nextPurpose = resolveAgentSessionPurposeForLoad({
      requestedSessionId: intent.requestedSessionId,
      externalSessionId: record.externalSessionId,
      shouldHydrateRequestedSession: intent.shouldHydrateRequestedSession,
      mode: intent.mode,
    });
    const existingSession = next[record.externalSessionId];
    const shouldPreserveTranscriptSession =
      intent.mode !== "requested_history" && intent.mode !== "recover_runtime_attachment";
    if (existingSession) {
      next[record.externalSessionId] = mergePersistedSessionRecord(
        existingSession,
        record,
        intent.taskId,
        intent.repoPath,
        existingSession.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
        nextPurpose,
        shouldPreserveTranscriptSession,
      );
      continue;
    }
    next[record.externalSessionId] = {
      ...fromPersistedSessionRecord(record, intent.taskId, intent.repoPath),
      purpose: nextPurpose,
      pendingApprovals: [],
      pendingQuestions: [],
      promptOverrides: EMPTY_PROMPT_OVERRIDES,
    };
  }
  return next;
};

export const preparePersistedSessionMergeStage = async ({
  intent,
  options,
  sessionsRef,
  setSessionsById,
  isStaleRepoOperation,
  loadPersistedRecords,
  loadRepoPromptOverrides,
}: PersistedSessionMergeStageInput): Promise<PersistedSessionMergeStageOutput> => {
  const currentRequestedSession = intent.requestedSessionId
    ? (sessionsRef.current[intent.requestedSessionId] ?? null)
    : null;
  const requestedHistoryRecordFromSession =
    intent.shouldHydrateRequestedSession &&
    options?.persistedRecords === undefined &&
    currentRequestedSession &&
    currentRequestedSession.taskId === intent.taskId
      ? toRequestedHistoryRecordFromSession(currentRequestedSession)
      : null;
  const shouldSkipPersistedSessionReload = requestedHistoryRecordFromSession !== null;

  const persistedRecords = shouldSkipPersistedSessionReload
    ? [requestedHistoryRecordFromSession]
    : await loadPersistedRecords();
  if (isStaleRepoOperation()) {
    return {
      persistedRecords,
      recordsToHydrate: [],
      historyHydrationSessionIds: new Set<string>(),
      getRepoPromptOverrides: () => Promise.resolve(EMPTY_PROMPT_OVERRIDES),
    };
  }

  let repoPromptOverridesPromise: Promise<RepoPromptOverrides> | null = null;
  const getRepoPromptOverrides = (): Promise<RepoPromptOverrides> => {
    if (repoPromptOverridesPromise === null) {
      repoPromptOverridesPromise = loadRepoPromptOverrides(intent.workspaceId);
    }
    return repoPromptOverridesPromise;
  };

  let sessionsForHydration = sessionsRef.current;
  if (!shouldSkipPersistedSessionReload) {
    sessionsForHydration = mergePersistedSessionRecords({
      current: sessionsForHydration,
      persistedRecords,
      intent,
    });
    setSessionsById(sessionsForHydration);
  }

  if (isStaleRepoOperation()) {
    return {
      persistedRecords,
      recordsToHydrate: [],
      historyHydrationSessionIds: new Set<string>(),
      getRepoPromptOverrides,
    };
  }

  const recordsToHydrateSource =
    intent.requestedSessionId !== null &&
    (intent.shouldHydrateRequestedSession || intent.mode === "recover_runtime_attachment")
      ? persistedRecords.filter((record) => record.externalSessionId === intent.requestedSessionId)
      : persistedRecords;
  const recordsToHydrate = recordsToHydrateSource.map((record) => {
    const existingSession = sessionsForHydration[record.externalSessionId];
    const existingWorkingDirectory = existingSession?.workingDirectory.trim() ?? "";
    if (
      existingSession &&
      existingSession.runtimeId !== null &&
      existingWorkingDirectory.length > 0
    ) {
      return {
        ...record,
        workingDirectory: existingSession.workingDirectory,
      };
    }
    return record;
  });
  const historyHydrationSessionIds = recordsToHydrate.reduce<Set<string>>((sessionIds, record) => {
    if (intent.historyPolicy !== "requested_only") {
      return sessionIds;
    }
    if (
      intent.requestedSessionId === null ||
      record.externalSessionId === intent.requestedSessionId
    ) {
      sessionIds.add(record.externalSessionId);
    }
    return sessionIds;
  }, new Set());

  return {
    persistedRecords,
    recordsToHydrate,
    historyHydrationSessionIds,
    getRepoPromptOverrides,
  };
};
