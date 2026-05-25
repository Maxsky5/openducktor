import type { AgentSessionRecord, RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { errorMessage } from "@/lib/errors";
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
import { type AgentSessionPresenceSnapshot, createSessionPresenceReader } from "./session-presence";
import { createAgentSessionPresenceSnapshotSource } from "./session-presence-source";

export type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type SessionLifecycleAdapter = Pick<
  AgentEnginePort,
  "hasSession" | "loadSessionHistory" | "resumeSession" | "attachSession"
> & {
  loadSessionTodos?: AgentEnginePort["loadSessionTodos"];
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
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
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
  repoPath: string;
  adapter: SessionLifecycleAdapter;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  updateSession: UpdateSession;
  isStaleRepoOperation: () => boolean;
  recordsToHydrate: AgentSessionRecord[];
  historyHydrationSessionIds: Set<string>;
  failOnRuntimeResolutionError?: boolean;
  subagentPendingInputMode?: SubagentPendingInputHydrationMode;
  runtimePlanner: HydrationRuntimePlanner;
  promptAssembler: HydrationPromptAssembler;
  getRepoPromptOverrides: () => Promise<RepoPromptOverrides>;
};

export type SubagentPendingInputHydrationMode = "skip" | "hydrate";

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
  hydrationError: SubagentPendingInputHydrationError | null;
};

class SubagentPendingInputHydrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubagentPendingInputHydrationError";
  }
}

const EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY = Object.freeze({
  scannedChildExternalSessionIds: [],
  pendingApprovalsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
  pendingQuestionsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
  hydrationError: null,
}) satisfies HydratedSubagentPendingInputOverlay;

const toHydratedSubagentPendingInputOverlay = (
  scannedChildExternalSessionIds: string[],
  pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId,
  pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId,
  hydrationError: SubagentPendingInputHydrationError | null = null,
): HydratedSubagentPendingInputOverlay => {
  if (scannedChildExternalSessionIds.length === 0 && hydrationError === null) {
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
    hydrationError,
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

  const results = await Promise.allSettled(
    childExternalSessionIds.map(async (childExternalSessionId) => {
      try {
        return {
          childExternalSessionId,
          snapshot: await readPlannerAgentSessionPresenceSnapshot(runtimePlanner, {
            ...record,
            externalSessionId: childExternalSessionId,
          }),
        };
      } catch (error) {
        throw new Error(`subagent session '${childExternalSessionId}': ${errorMessage(error)}`);
      }
    }),
  );
  const pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId = {};
  const pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId = {};
  const scannedChildExternalSessionIds: string[] = [];
  const failures: string[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      failures.push(errorMessage(result.reason));
      continue;
    }
    const { childExternalSessionId, snapshot } = result.value;
    scannedChildExternalSessionIds.push(childExternalSessionId);
    if (snapshot.presence === "runtime" && snapshot.pendingApprovals.length > 0) {
      pendingApprovalsByChildExternalSessionId[childExternalSessionId] = snapshot.pendingApprovals;
    }
    if (snapshot.presence === "runtime" && snapshot.pendingQuestions.length > 0) {
      pendingQuestionsByChildExternalSessionId[childExternalSessionId] = snapshot.pendingQuestions;
    }
  }
  const hydrationError =
    failures.length > 0
      ? new SubagentPendingInputHydrationError(
          `Failed to hydrate subagent pending input: ${failures.join("; ")}`,
        )
      : null;

  return toHydratedSubagentPendingInputOverlay(
    scannedChildExternalSessionIds,
    pendingApprovalsByChildExternalSessionId,
    pendingQuestionsByChildExternalSessionId,
    hydrationError,
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

export const createRuntimeResolutionPlannerStage = async ({
  intent,
  options,
  adapter,
}: RuntimeResolutionPlannerStageInput): Promise<HydrationRuntimePlanner> => {
  const preloadedSessionPresenceByKey =
    options?.preloadedSessionPresenceByKey ?? new Map<string, AgentSessionPresenceSnapshot[]>();

  const resolveHydrationRuntime = createHydrationRuntimeResolver({
    repoPath: intent.repoPath,
  });
  const sessionPresenceSource = createAgentSessionPresenceSnapshotSource({
    adapter,
    preloadedSessionPresenceByKey,
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
  sessionsRef,
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
    getCurrentSession: (externalSessionId) => sessionsRef.current[externalSessionId] ?? null,
    updateSession,
    ...(attachSessionListener ? { attachSessionListener } : {}),
    promptOverrides: EMPTY_PROMPT_OVERRIDES,
    readSessionPresence: (record) =>
      readPlannerAgentSessionPresenceSnapshot(runtimePlanner, record),
    attachMissingLiveSession: async ({ record, runtimeKind, workingDirectory }) => {
      if (isStaleRepoOperation()) {
        return;
      }
      const promptOverrides = await getRepoPromptOverrides();
      if (!isStaleRepoOperation()) {
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
        } else {
          await adapter.resumeSession(attachInput);
        }
      }
    },
    allowAttachMissingSession: options?.allowLiveSessionResume !== false,
    isStaleRepoOperation,
  });

  const reattachedSessionIds = new Set<string>();
  const processReattachBatch = async (offset: number): Promise<void> => {
    if (offset >= recordsToHydrate.length) {
      return;
    }
    if (isStaleRepoOperation()) {
      return;
    }
    const batch = recordsToHydrate.slice(offset, offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
    const reattachResults = await Promise.all(
      batch.map(async (record) => ({
        record,
        reattached: await maybeResumeLiveRecord(record),
      })),
    );
    if (!isStaleRepoOperation()) {
      for (const { record, reattached } of reattachResults) {
        if (reattached) {
          reattachedSessionIds.add(record.externalSessionId);
        }
      }
    }
    await processReattachBatch(offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
  };

  await processReattachBatch(0);

  return { reattachedSessionIds };
};

type SuccessfulHydrationRuntime = Extract<ResolvedHydrationRuntime, { ok: true }>;
type FailedHydrationRuntime = Extract<ResolvedHydrationRuntime, { ok: false }>;

type HydrateSessionRecordInput = {
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
  subagentPendingInputMode: SubagentPendingInputHydrationMode;
};

type HydratedRecordHistoryState = {
  promptOverrides: RepoPromptOverrides;
  history: Awaited<ReturnType<SessionLifecycleAdapter["loadSessionHistory"]>>;
  todos: Awaited<ReturnType<AgentEnginePort["loadSessionTodos"]>>;
  runtimeResolution: SuccessfulHydrationRuntime;
  hydratedMessages: AgentSessionState["messages"];
  hydratedSubagentPendingInputByExternalSessionId: HydratedSubagentPendingInputOverlay;
};

const markHistoryHydrationFailed = (
  externalSessionId: string,
  updateSession: UpdateSession,
  options?: { preserveSubagentPendingInput?: boolean },
): void => {
  updateSession(
    externalSessionId,
    (current) => ({
      ...current,
      historyHydrationState: "failed",
      subagentPendingApprovalsByExternalSessionId: options?.preserveSubagentPendingInput
        ? current.subagentPendingApprovalsByExternalSessionId
        : undefined,
      subagentPendingQuestionsByExternalSessionId: options?.preserveSubagentPendingInput
        ? current.subagentPendingQuestionsByExternalSessionId
        : undefined,
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
  updateSession,
  isStaleRepoOperation,
  record,
  runtimeResolution,
}: {
  updateSession: UpdateSession;
  isStaleRepoOperation: () => boolean;
  record: AgentSessionRecord;
  runtimeResolution: SuccessfulHydrationRuntime;
}): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }

  const { runtimeRef, workingDirectory } = runtimeResolution;
  updateSession(
    record.externalSessionId,
    (current) => ({
      ...current,
      runtimeKind: runtimeRef.runtimeKind,
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
    todos,
    runtimeResolution,
    hydratedMessages,
    hydratedSubagentPendingInputByExternalSessionId,
  }: HydratedRecordHistoryState,
): AgentSessionState => {
  const nextSession: AgentSessionState = {
    ...current,
    runtimeKind: runtimeResolution.runtimeRef.runtimeKind,
    workingDirectory: runtimeResolution.workingDirectory,
    promptOverrides,
    historyHydrationState: "hydrated",
    runtimeRecoveryState: current.runtimeRecoveryState ?? "idle",
    todos,
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
    contextUsage: historyToSessionContextUsage(history),
    messages: mergeHydratedMessages(current.externalSessionId, hydratedMessages, current.messages),
  };

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
  subagentPendingInputMode,
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
  subagentPendingInputMode: SubagentPendingInputHydrationMode;
}): Promise<void> => {
  const shouldHydrateSubagentPendingInput = subagentPendingInputMode === "hydrate";
  const { runtimeRef, workingDirectory } = runtimeResolution;
  const [promptOverrides, history, todos] = await Promise.all([
    getRepoPromptOverrides(),
    adapter.loadSessionHistory({
      repoPath,
      runtimeKind: runtimeRef.runtimeKind,
      workingDirectory,
      externalSessionId: record.externalSessionId,
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    }),
    adapter.loadSessionTodos
      ? adapter.loadSessionTodos({
          repoPath,
          runtimeKind: runtimeRef.runtimeKind,
          workingDirectory,
          externalSessionId: record.externalSessionId,
        })
      : Promise.resolve([]),
  ]);
  const preludeMessages = await promptAssembler.buildHydrationPreludeMessages({
    record,
    promptOverrides,
  });
  const selectedModel = normalizePersistedSelection(record.selectedModel);
  const hydratedMessages = createSessionMessagesState(record.externalSessionId, [
    ...getSessionMessagesSlice(
      {
        externalSessionId: record.externalSessionId,
        messages: preludeMessages,
      },
      0,
    ),
    ...historyToChatMessages(history, {
      role: record.role,
      selectedModel,
    }),
  ]);
  const hydratedSubagentPendingInputByExternalSessionId = shouldHydrateSubagentPendingInput
    ? await loadHydratedSubagentPendingInputOverlay({
        record,
        messages: hydratedMessages,
        runtimePlanner,
      })
    : EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY;
  if (isStaleRepoOperation()) {
    return;
  }

  updateSession(
    record.externalSessionId,
    (current) =>
      applyHydratedRecordHistory(current, {
        promptOverrides,
        history,
        todos,
        runtimeResolution,
        hydratedMessages,
        hydratedSubagentPendingInputByExternalSessionId,
      }),
    { persist: false },
  );

  if (hydratedSubagentPendingInputByExternalSessionId.hydrationError) {
    throw hydratedSubagentPendingInputByExternalSessionId.hydrationError;
  }
};

const hydrateSessionRecord = async ({
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
  subagentPendingInputMode,
}: HydrateSessionRecordInput): Promise<void> => {
  if (isStaleRepoOperation()) {
    return;
  }
  const runtimeResolution = await runtimePlanner.resolveHydrationRuntime(record);
  if (!isStaleRepoOperation()) {
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
        updateSession,
        isStaleRepoOperation,
        record,
        runtimeResolution,
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
      subagentPendingInputMode,
    });
  }
};

export const hydrateSessionRecordsStage = async ({
  repoPath,
  adapter,
  setSessionsById,
  updateSession,
  isStaleRepoOperation,
  recordsToHydrate,
  historyHydrationSessionIds,
  failOnRuntimeResolutionError = false,
  subagentPendingInputMode = "skip",
  runtimePlanner,
  promptAssembler,
  getRepoPromptOverrides,
}: HistoryHydrationStageInput): Promise<void> => {
  if (recordsToHydrate.length === 0) {
    return;
  }

  markRequestedHistoryHydrationInProgress({
    historyHydrationSessionIds,
    setSessionsById,
  });

  const processHydrationBatch = async (offset: number): Promise<void> => {
    if (offset >= recordsToHydrate.length) {
      return;
    }
    if (isStaleRepoOperation()) {
      return;
    }
    const batch = recordsToHydrate.slice(offset, offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
    await Promise.all(
      batch.map((record) =>
        hydrateSessionRecord({
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
          subagentPendingInputMode,
        }).catch((error) => {
          if (historyHydrationSessionIds.has(record.externalSessionId)) {
            markHistoryHydrationFailed(record.externalSessionId, updateSession, {
              preserveSubagentPendingInput: error instanceof SubagentPendingInputHydrationError,
            });
          }
          throw error;
        }),
      ),
    );
    await processHydrationBatch(offset + SESSION_HISTORY_HYDRATION_CONCURRENCY);
  };

  await processHydrationBatch(0);
};
