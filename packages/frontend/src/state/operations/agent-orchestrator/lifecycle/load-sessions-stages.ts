import type { AgentSessionRecord, RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { errorMessage } from "@/lib/errors";
import { appQueryClient } from "@/lib/query-client";
import { loadRuntimeListFromQuery } from "@/state/queries/runtime";
import type {
  AgentSessionHistoryHydrationPolicy,
  AgentSessionHistoryPreludeMode,
  AgentSessionLoadMode,
  AgentSessionLoadOptions,
  AgentSessionPurpose,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { DEFAULT_AGENT_SESSION_HISTORY_HYDRATION_STATE } from "../support/history-hydration";
import { mergeHydratedMessages } from "../support/hydrated-message-merge";
import {
  createSessionMessagesState,
  forEachSessionMessage,
  getSessionMessagesSlice,
} from "../support/messages";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import {
  fromPersistedSessionRecord,
  historyToChatMessages,
  historyToSessionContextUsage,
} from "../support/persistence";
import { buildSessionHeaderMessages, buildSessionSystemPrompt } from "../support/session-prompt";
import {
  isTranscriptAgentSession,
  isWorkflowAgentSession,
  resolveAgentSessionPurposeForLoad,
} from "../support/session-purpose";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import {
  EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
  EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
  mergeSubagentPendingApprovalOverlay,
  mergeSubagentPendingQuestionOverlay,
  type SubagentPendingApprovalsByExternalSessionId,
  type SubagentPendingQuestionsByExternalSessionId,
} from "../support/subagent-approval-overlay";
import { isSubagentMessage } from "../support/subagent-messages";
import {
  createHydrationRuntimeResolver,
  type ResolvedHydrationRuntime,
} from "./hydration-runtime-resolution";
import { createReattachLiveSession } from "./reattach-live-session";
import {
  type AgentSessionPresenceSnapshot,
  applyAgentSessionPresenceSnapshotToSession,
  createSessionPresenceReader,
} from "./session-presence";
import { createAgentSessionPresenceSnapshotSource } from "./session-presence-source";
import type { AgentSessionPresenceStore } from "./session-presence-store";

export type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type SessionLifecycleAdapter = Pick<
  AgentEnginePort,
  "hasSession" | "loadSessionHistory" | "resumeSession" | "attachSession"
> & {
  listSessionPresence?: AgentEnginePort["listSessionPresence"];
  readSessionPresence?: AgentEnginePort["readSessionPresence"];
};

export type SessionLoadIntent = {
  repoPath: string;
  workspaceId: string;
  taskId: string;
  mode: AgentSessionLoadMode;
  requestedSessionId: string | null;
  requestedHistoryKey: string | null;
  shouldHydrateRequestedSession: boolean;
  shouldReconcileLiveSessions: boolean;
  historyPolicy: AgentSessionHistoryHydrationPolicy;
};

export { mergeHydratedMessages };

export type PersistedSessionMergeStageInput = {
  intent: SessionLoadIntent;
  options?: AgentSessionLoadOptions;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  isStaleRepoOperation: () => boolean;
  loadPersistedRecords: () => Promise<AgentSessionRecord[]>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

export type PersistedSessionMergeStageOutput = {
  persistedRecords: AgentSessionRecord[];
  recordsToHydrate: AgentSessionRecord[];
  historyHydrationSessionIds: Set<string>;
  getRepoPromptOverrides: () => Promise<RepoPromptOverrides>;
};

export type HydrationRuntimePlanner = {
  repoPath: string;
  resolveHydrationRuntime: (record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>;
  readSessionPresence: (record: AgentSessionRecord) => Promise<AgentSessionPresenceSnapshot>;
};

const readPlannerAgentSessionPresenceSnapshot = async (
  runtimePlanner: HydrationRuntimePlanner,
  record: AgentSessionRecord,
): Promise<AgentSessionPresenceSnapshot> => {
  return runtimePlanner.readSessionPresence(record);
};

export type RuntimeResolutionPlannerStageInput = {
  intent: SessionLoadIntent;
  options?: AgentSessionLoadOptions;
  adapter: SessionLifecycleAdapter;
  agentSessionPresenceStore?: AgentSessionPresenceStore;
  recordsToHydrate: AgentSessionRecord[];
};

export type HydrationPromptAssembler = {
  buildHydrationPreludeMessages: (input: {
    record: AgentSessionRecord;
    promptOverrides: RepoPromptOverrides;
  }) => Promise<AgentSessionState["messages"]>;
  buildHydrationSystemPrompt: (input: {
    record: AgentSessionRecord;
    promptOverrides: RepoPromptOverrides;
  }) => Promise<string>;
};

export type PromptAssemblerStageInput = {
  taskId: string;
  taskRef: MutableRefObject<TaskCard[]>;
  historyPreludeMode?: AgentSessionHistoryPreludeMode;
};

export type LiveReconciliationStageInput = {
  intent: SessionLoadIntent;
  options?: AgentSessionLoadOptions;
  adapter: SessionLifecycleAdapter;
  updateSession: UpdateSession;
  attachSessionListener?: (repoPath: string, externalSessionId: string) => void;
  isStaleRepoOperation: () => boolean;
  recordsToHydrate: AgentSessionRecord[];
  runtimePlanner: HydrationRuntimePlanner;
  promptAssembler: HydrationPromptAssembler;
  getRepoPromptOverrides: () => Promise<RepoPromptOverrides>;
};

export type LiveReconciliationStageOutput = {
  reattachedSessionIds: Set<string>;
};

export type HistoryHydrationStageInput = {
  loadMode?: AgentSessionLoadMode;
  repoPath: string;
  adapter: SessionLifecycleAdapter;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  updateSession: UpdateSession;
  isStaleRepoOperation: () => boolean;
  recordsToHydrate: AgentSessionRecord[];
  historyHydrationSessionIds: Set<string>;
  failOnRuntimeResolutionError?: boolean;
  runtimePlanner: HydrationRuntimePlanner;
  promptAssembler: HydrationPromptAssembler;
  getRepoPromptOverrides: () => Promise<RepoPromptOverrides>;
};

const INITIAL_SESSION_HISTORY_LIMIT = 600;
const SESSION_HISTORY_HYDRATION_CONCURRENCY = 3;
const EMPTY_PROMPT_OVERRIDES: RepoPromptOverrides = {};

const readSubagentSessionIds = (
  externalSessionId: string,
  messages: AgentSessionState["messages"],
): string[] => {
  const externalSessionIds = new Set<string>();
  forEachSessionMessage({ externalSessionId, messages }, (message) => {
    if (!isSubagentMessage(message)) {
      return;
    }
    const subagentSessionId = message.meta.externalSessionId?.trim();
    if (subagentSessionId) {
      externalSessionIds.add(subagentSessionId);
    }
  });
  return Array.from(externalSessionIds);
};

type HydratedSubagentPendingInputOverlay = {
  scannedChildExternalSessionIds: string[];
  pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId;
  pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId;
};

const EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY = Object.freeze({
  scannedChildExternalSessionIds: [],
  pendingApprovalsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
  pendingQuestionsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
}) satisfies HydratedSubagentPendingInputOverlay;

const toHydratedSubagentPendingInputOverlay = (
  scannedChildExternalSessionIds: string[],
  pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId,
  pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId,
): HydratedSubagentPendingInputOverlay => {
  if (scannedChildExternalSessionIds.length === 0) {
    return EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY;
  }

  return {
    scannedChildExternalSessionIds,
    pendingApprovalsByChildExternalSessionId:
      Object.keys(pendingApprovalsByChildExternalSessionId).length > 0
        ? pendingApprovalsByChildExternalSessionId
        : EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
    pendingQuestionsByChildExternalSessionId:
      Object.keys(pendingQuestionsByChildExternalSessionId).length > 0
        ? pendingQuestionsByChildExternalSessionId
        : EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
  };
};

const loadHydratedSubagentPendingInputOverlay = async ({
  record,
  messages,
  runtimePlanner,
}: {
  record: AgentSessionRecord;
  messages: AgentSessionState["messages"];
  runtimePlanner: HydrationRuntimePlanner;
}): Promise<HydratedSubagentPendingInputOverlay> => {
  const childExternalSessionIds = readSubagentSessionIds(record.externalSessionId, messages);
  if (childExternalSessionIds.length === 0) {
    return EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY;
  }

  const pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId = {};
  const pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId = {};
  const scannedChildExternalSessionIds: string[] = [];
  await Promise.all(
    childExternalSessionIds.map(async (childExternalSessionId) => {
      try {
        const snapshot = await readPlannerAgentSessionPresenceSnapshot(runtimePlanner, {
          ...record,
          externalSessionId: childExternalSessionId,
        });
        scannedChildExternalSessionIds.push(childExternalSessionId);
        if (snapshot.presence === "runtime" && snapshot.pendingApprovals.length > 0) {
          pendingApprovalsByChildExternalSessionId[childExternalSessionId] =
            snapshot.pendingApprovals;
        }
        if (snapshot.presence === "runtime" && snapshot.pendingQuestions.length > 0) {
          pendingQuestionsByChildExternalSessionId[childExternalSessionId] =
            snapshot.pendingQuestions;
        }
      } catch (error) {
        console.warn(
          `Failed to hydrate pending input for subagent session '${childExternalSessionId}': ${errorMessage(error)}`,
        );
      }
    }),
  );

  return toHydratedSubagentPendingInputOverlay(
    scannedChildExternalSessionIds,
    pendingApprovalsByChildExternalSessionId,
    pendingQuestionsByChildExternalSessionId,
  );
};

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

  if (!shouldSkipPersistedSessionReload) {
    setSessionsById((current) => {
      if (isStaleRepoOperation()) {
        return current;
      }
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
    });
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
    const existingSession = sessionsRef.current[record.externalSessionId];
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
  const historyHydrationSessionIds = new Set(
    recordsToHydrate
      .filter((record) => {
        if (intent.historyPolicy !== "requested_only") {
          return false;
        }
        return (
          intent.requestedSessionId === null ||
          record.externalSessionId === intent.requestedSessionId
        );
      })
      .map((record) => record.externalSessionId),
  );

  return {
    persistedRecords,
    recordsToHydrate,
    historyHydrationSessionIds,
    getRepoPromptOverrides,
  };
};

export const createRuntimeResolutionPlannerStage = async ({
  intent,
  options,
  adapter,
  agentSessionPresenceStore,
  recordsToHydrate,
}: RuntimeResolutionPlannerStageInput): Promise<HydrationRuntimePlanner> => {
  const recordsNeedingRuntimeResolution = recordsToHydrate;

  const runtimeKindsToInspect = Array.from(
    new Set(recordsNeedingRuntimeResolution.map((record) => readPersistedRuntimeKind(record))),
  );
  const runtimesByKind =
    options?.preloadedRuntimeLists ??
    new Map(
      await Promise.all(
        runtimeKindsToInspect.map(async (runtimeKind) => {
          const runtimes = await loadRuntimeListFromQuery(
            appQueryClient,
            runtimeKind,
            intent.repoPath,
          );
          return [runtimeKind, runtimes] as const;
        }),
      ),
    );

  const preloadedSessionPresenceByKey =
    options?.preloadedSessionPresenceByKey ?? new Map<string, AgentSessionPresenceSnapshot[]>();

  const resolveHydrationRuntime = createHydrationRuntimeResolver({
    repoPath: intent.repoPath,
    runtimesByKind,
  });
  const sessionPresenceSource = createAgentSessionPresenceSnapshotSource({
    adapter,
    preloadedSessionPresenceByKey,
    ...(agentSessionPresenceStore ? { agentSessionPresenceStore } : {}),
  });
  const readSessionPresence = createSessionPresenceReader({
    repoPath: intent.repoPath,
    resolveHydrationRuntime,
    readPresence: sessionPresenceSource.read,
  });

  return {
    repoPath: intent.repoPath,
    resolveHydrationRuntime,
    readSessionPresence,
  };
};

export const createHydrationPromptAssemblerStage = ({
  taskId,
  taskRef,
  historyPreludeMode = "task_context",
}: PromptAssemblerStageInput): HydrationPromptAssembler => {
  const buildHydrationPreludeMessages = async ({
    record,
    promptOverrides,
  }: {
    record: AgentSessionRecord;
    promptOverrides: RepoPromptOverrides;
  }): Promise<AgentSessionState["messages"]> => {
    if (historyPreludeMode === "none") {
      return [];
    }
    const task = taskRef.current.find((entry) => entry.id === taskId);
    if (!task) {
      return buildSessionHeaderMessages({
        externalSessionId: record.externalSessionId,
        systemPrompt: "",
        startedAt: record.startedAt,
        includeSystemPrompt: false,
      });
    }

    const systemPrompt = buildSessionSystemPrompt({
      role: record.role,
      task,
      promptOverrides,
    });

    return buildSessionHeaderMessages({
      externalSessionId: record.externalSessionId,
      systemPrompt,
      startedAt: record.startedAt,
    });
  };

  const buildHydrationSystemPrompt = async ({
    record,
    promptOverrides,
  }: {
    record: AgentSessionRecord;
    promptOverrides: RepoPromptOverrides;
  }): Promise<string> => {
    if (historyPreludeMode === "none") {
      return "";
    }
    const task = taskRef.current.find((entry) => entry.id === taskId);
    if (!task) {
      return "";
    }

    return buildSessionSystemPrompt({
      role: record.role,
      task,
      promptOverrides,
    });
  };

  return {
    buildHydrationPreludeMessages,
    buildHydrationSystemPrompt,
  };
};

export const reconcileLiveSessionsStage = async ({
  intent,
  options,
  adapter,
  updateSession,
  attachSessionListener,
  isStaleRepoOperation,
  recordsToHydrate,
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
}: LiveReconciliationStageInput): Promise<LiveReconciliationStageOutput> => {
  if (!intent.shouldReconcileLiveSessions) {
    return { reattachedSessionIds: new Set<string>() };
  }
  const maybeResumeLiveRecord = createReattachLiveSession({
    adapter,
    repoPath: intent.repoPath,
    updateSession,
    ...(attachSessionListener ? { attachSessionListener } : {}),
    promptOverrides: EMPTY_PROMPT_OVERRIDES,
    readSessionPresence: (record) =>
      readPlannerAgentSessionPresenceSnapshot(runtimePlanner, record),
    attachMissingLiveSession: async ({ record, runtimeKind, workingDirectory }) => {
      const promptOverrides = await getRepoPromptOverrides();
      if (isStaleRepoOperation()) {
        return;
      }
      const selectedModel = normalizePersistedSelection(record.selectedModel);
      const systemPrompt = await promptAssembler.buildHydrationSystemPrompt({
        record,
        promptOverrides,
      });
      if (isStaleRepoOperation()) {
        return;
      }

      const attachInput = {
        externalSessionId: record.externalSessionId,
        repoPath: intent.repoPath,
        runtimeKind,
        workingDirectory,
        taskId: intent.taskId,
        role: record.role,
        systemPrompt,
        ...(selectedModel ? { model: selectedModel } : {}),
      };

      if (intent.mode === "requested_history") {
        await adapter.attachSession(attachInput);
        return;
      }

      await adapter.resumeSession(attachInput);
    },
    allowAttachMissingSession: options?.allowLiveSessionResume !== false,
    isStaleRepoOperation,
  });

  const reattachedSessionIds = new Set<string>();
  for (
    let offset = 0;
    offset < recordsToHydrate.length;
    offset += SESSION_HISTORY_HYDRATION_CONCURRENCY
  ) {
    if (isStaleRepoOperation()) {
      return { reattachedSessionIds };
    }
    const batch = recordsToHydrate.slice(offset, offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
    const reattachResults = await Promise.all(
      batch.map(async (record) => ({
        record,
        reattached: await maybeResumeLiveRecord(record),
      })),
    );
    if (isStaleRepoOperation()) {
      return { reattachedSessionIds };
    }
    for (const { record, reattached } of reattachResults) {
      if (reattached) {
        reattachedSessionIds.add(record.externalSessionId);
        continue;
      }
      updateSession(
        record.externalSessionId,
        (current) => ({
          ...current,
          pendingApprovals: [],
          pendingQuestions: [],
        }),
        { persist: false },
      );
    }
  }

  return { reattachedSessionIds };
};

type SuccessfulHydrationRuntime = Extract<ResolvedHydrationRuntime, { ok: true }>;
type FailedHydrationRuntime = Extract<ResolvedHydrationRuntime, { ok: false }>;

type HydrateSessionRecordInput = {
  loadMode: AgentSessionLoadMode;
  repoPath: string;
  adapter: SessionLifecycleAdapter;
  updateSession: UpdateSession;
  isStaleRepoOperation: () => boolean;
  record: AgentSessionRecord;
  shouldHydrateHistory: boolean;
  failOnRuntimeResolutionError: boolean;
  runtimePlanner: HydrationRuntimePlanner;
  promptAssembler: HydrationPromptAssembler;
  getRepoPromptOverrides: () => Promise<RepoPromptOverrides>;
};

type HydratedRecordHistoryState = {
  promptOverrides: RepoPromptOverrides;
  history: Awaited<ReturnType<SessionLifecycleAdapter["loadSessionHistory"]>>;
  sessionPresence: AgentSessionPresenceSnapshot;
  hydratedMessages: AgentSessionState["messages"];
  hydratedSubagentPendingInputByExternalSessionId: HydratedSubagentPendingInputOverlay;
  selectedModel: ReturnType<typeof normalizePersistedSelection>;
};

const markHistoryHydrationFailed = (
  externalSessionId: string,
  updateSession: UpdateSession,
): void => {
  updateSession(
    externalSessionId,
    (current) => ({
      ...current,
      historyHydrationState: "failed",
    }),
    { persist: false },
  );
};

const markRequestedHistoryHydrationInProgress = ({
  historyHydrationSessionIds,
  setSessionsById,
}: {
  historyHydrationSessionIds: Set<string>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
}): void => {
  if (historyHydrationSessionIds.size > 0) {
    setSessionsById((current) => {
      const next = { ...current };
      for (const externalSessionId of historyHydrationSessionIds) {
        const existingSession = next[externalSessionId];
        if (!existingSession) {
          continue;
        }
        next[externalSessionId] = {
          ...existingSession,
          historyHydrationState: "hydrating",
        };
      }
      return next;
    });
  }
};

const applyMissingHydrationRuntime = ({
  record,
  runtimeResolution,
  shouldHydrateHistory,
  failOnRuntimeResolutionError,
  updateSession,
}: {
  record: AgentSessionRecord;
  runtimeResolution: FailedHydrationRuntime;
  shouldHydrateHistory: boolean;
  failOnRuntimeResolutionError: boolean;
  updateSession: UpdateSession;
}): void => {
  if (shouldHydrateHistory) {
    markHistoryHydrationFailed(record.externalSessionId, updateSession);
    throw new Error(runtimeResolution.reason);
  }
  if (failOnRuntimeResolutionError) {
    throw new Error(runtimeResolution.reason);
  }
  updateSession(
    record.externalSessionId,
    (current) => ({
      ...current,
      runtimeKind: readPersistedRuntimeKind(record),
      runtimeId: null,
      workingDirectory: record.workingDirectory,
      promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
    }),
    { persist: false },
  );
};

const hydrateRuntimeOnlyRecord = async ({
  loadMode,
  updateSession,
  isStaleRepoOperation,
  record,
  runtimeResolution,
  runtimePlanner,
}: {
  loadMode: AgentSessionLoadMode;
  updateSession: UpdateSession;
  isStaleRepoOperation: () => boolean;
  record: AgentSessionRecord;
  runtimeResolution: SuccessfulHydrationRuntime;
  runtimePlanner: HydrationRuntimePlanner;
}): Promise<void> => {
  const shouldReadSessionPresenceSnapshot =
    loadMode === "reconcile_live" || loadMode === "recover_runtime_attachment";
  const sessionPresence = shouldReadSessionPresenceSnapshot
    ? await readPlannerAgentSessionPresenceSnapshot(runtimePlanner, record)
    : null;
  if (isStaleRepoOperation()) {
    return;
  }
  if (sessionPresence) {
    updateSession(
      record.externalSessionId,
      (current) =>
        applyAgentSessionPresenceSnapshotToSession(current, sessionPresence, {
          promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
          missingSessionRuntimeId: null,
        }),
      { persist: false },
    );
    return;
  }

  const { runtimeKind, runtimeId, workingDirectory } = runtimeResolution;
  updateSession(
    record.externalSessionId,
    (current) => ({
      ...current,
      runtimeKind,
      runtimeId,
      workingDirectory,
      promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
    }),
    { persist: false },
  );
};

const applyHydratedRecordHistory = (
  current: AgentSessionState,
  {
    promptOverrides,
    history,
    sessionPresence,
    hydratedMessages,
    hydratedSubagentPendingInputByExternalSessionId,
    selectedModel,
  }: HydratedRecordHistoryState,
): AgentSessionState => {
  const liveSessionStatus =
    sessionPresence.presence === "runtime" ? sessionPresence.agentSessionStatus : null;
  const liveSessionTitle =
    sessionPresence.presence === "runtime" ? sessionPresence.title : undefined;
  const sessionWithSessionPresenceSnapshot = applyAgentSessionPresenceSnapshotToSession(
    current,
    sessionPresence,
    {
      promptOverrides,
    },
  );
  const nextSession: AgentSessionState = {
    ...sessionWithSessionPresenceSnapshot,
    status: liveSessionStatus ?? sessionWithSessionPresenceSnapshot.status,
    historyHydrationState: "hydrated",
    runtimeRecoveryState: "idle",
    subagentPendingApprovalsByExternalSessionId: mergeSubagentPendingApprovalOverlay({
      current: current.subagentPendingApprovalsByExternalSessionId,
      scannedChildExternalSessionIds:
        hydratedSubagentPendingInputByExternalSessionId.scannedChildExternalSessionIds,
      pendingApprovalsByChildExternalSessionId:
        hydratedSubagentPendingInputByExternalSessionId.pendingApprovalsByChildExternalSessionId,
    }),
    subagentPendingQuestionsByExternalSessionId: mergeSubagentPendingQuestionOverlay({
      current: current.subagentPendingQuestionsByExternalSessionId,
      scannedChildExternalSessionIds:
        hydratedSubagentPendingInputByExternalSessionId.scannedChildExternalSessionIds,
      pendingQuestionsByChildExternalSessionId:
        hydratedSubagentPendingInputByExternalSessionId.pendingQuestionsByChildExternalSessionId,
    }),
    contextUsage: historyToSessionContextUsage(history, selectedModel),
    messages: mergeHydratedMessages(current.externalSessionId, hydratedMessages, current.messages),
  };

  if (sessionPresence.presence === "runtime") {
    if (liveSessionTitle) {
      nextSession.title = liveSessionTitle;
    } else {
      delete nextSession.title;
    }
  }
  return nextSession;
};

const hydrateRecordHistory = async ({
  repoPath,
  adapter,
  updateSession,
  isStaleRepoOperation,
  record,
  runtimeResolution,
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
}: {
  repoPath: string;
  adapter: SessionLifecycleAdapter;
  updateSession: UpdateSession;
  isStaleRepoOperation: () => boolean;
  record: AgentSessionRecord;
  runtimeResolution: SuccessfulHydrationRuntime;
  runtimePlanner: HydrationRuntimePlanner;
  promptAssembler: HydrationPromptAssembler;
  getRepoPromptOverrides: () => Promise<RepoPromptOverrides>;
}): Promise<void> => {
  const { runtimeKind, workingDirectory } = runtimeResolution;
  const promptOverrides = await getRepoPromptOverrides();
  const preludeMessages = await promptAssembler.buildHydrationPreludeMessages({
    record,
    promptOverrides,
  });
  const history = await adapter.loadSessionHistory({
    repoPath,
    runtimeKind,
    workingDirectory,
    externalSessionId: record.externalSessionId,
    limit: INITIAL_SESSION_HISTORY_LIMIT,
  });
  const sessionPresence = await readPlannerAgentSessionPresenceSnapshot(runtimePlanner, record);
  const selectedModel = normalizePersistedSelection(record.selectedModel);
  const hydratedMessages = createSessionMessagesState(record.externalSessionId, [
    ...getSessionMessagesSlice(
      { externalSessionId: record.externalSessionId, messages: preludeMessages },
      0,
    ),
    ...historyToChatMessages(history, {
      role: record.role,
      selectedModel,
    }),
  ]);
  const hydratedSubagentPendingInputByExternalSessionId =
    await loadHydratedSubagentPendingInputOverlay({
      record,
      messages: hydratedMessages,
      runtimePlanner,
    });
  if (isStaleRepoOperation()) {
    return;
  }

  updateSession(
    record.externalSessionId,
    (current) =>
      applyHydratedRecordHistory(current, {
        promptOverrides,
        history,
        sessionPresence,
        hydratedMessages,
        hydratedSubagentPendingInputByExternalSessionId,
        selectedModel,
      }),
    { persist: false },
  );
};

const hydrateSessionRecord = async ({
  loadMode,
  repoPath,
  adapter,
  updateSession,
  isStaleRepoOperation,
  record,
  shouldHydrateHistory,
  failOnRuntimeResolutionError,
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
}: HydrateSessionRecordInput): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }

  const runtimeResolution = await runtimePlanner.resolveHydrationRuntime(record);
  if (isStaleRepoOperation()) {
    return;
  }
  if (!runtimeResolution.ok) {
    applyMissingHydrationRuntime({
      record,
      runtimeResolution,
      shouldHydrateHistory,
      failOnRuntimeResolutionError,
      updateSession,
    });
    return;
  }

  if (!shouldHydrateHistory) {
    await hydrateRuntimeOnlyRecord({
      loadMode,
      updateSession,
      isStaleRepoOperation,
      record,
      runtimeResolution,
      runtimePlanner,
    });
    return;
  }

  await hydrateRecordHistory({
    repoPath,
    adapter,
    updateSession,
    isStaleRepoOperation,
    record,
    runtimeResolution,
    runtimePlanner,
    promptAssembler,
    getRepoPromptOverrides,
  });
};

export const hydrateSessionRecordsStage = async ({
  loadMode = "bootstrap",
  repoPath,
  adapter,
  setSessionsById,
  updateSession,
  isStaleRepoOperation,
  recordsToHydrate,
  historyHydrationSessionIds,
  failOnRuntimeResolutionError = false,
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
}: HistoryHydrationStageInput): Promise<void> => {
  if (recordsToHydrate.length === 0) {
    return;
  }

  markRequestedHistoryHydrationInProgress({ historyHydrationSessionIds, setSessionsById });

  for (
    let offset = 0;
    offset < recordsToHydrate.length;
    offset += SESSION_HISTORY_HYDRATION_CONCURRENCY
  ) {
    if (isStaleRepoOperation()) {
      return;
    }
    const batch = recordsToHydrate.slice(offset, offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
    await Promise.all(
      batch.map((record) =>
        hydrateSessionRecord({
          loadMode,
          repoPath,
          adapter,
          updateSession,
          isStaleRepoOperation,
          record,
          shouldHydrateHistory: historyHydrationSessionIds.has(record.externalSessionId),
          failOnRuntimeResolutionError,
          runtimePlanner,
          promptAssembler,
          getRepoPromptOverrides,
        }).catch((error) => {
          if (historyHydrationSessionIds.has(record.externalSessionId)) {
            markHistoryHydrationFailed(record.externalSessionId, updateSession);
          }
          throw error;
        }),
      ),
    );
  }
};
