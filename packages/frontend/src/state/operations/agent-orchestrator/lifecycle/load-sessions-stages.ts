import type {
  AgentSessionRecord,
  RepoPromptOverrides,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentRuntimeConnection,
  LiveAgentSessionSnapshot,
} from "@openducktor/core";
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
import { host } from "../../shared/host";
import { ensureRuntimeAndInvalidateReadinessQueries } from "../../shared/runtime-readiness-publication";
import { runtimeRouteToConnection } from "../runtime/runtime";
import { normalizeWorkingDirectory } from "../support/core";
import { DEFAULT_AGENT_SESSION_HISTORY_HYDRATION_STATE } from "../support/history-hydration";
import { mergeHydratedMessages } from "../support/hydrated-message-merge";
import {
  createSessionMessagesState,
  forEachSessionMessage,
  getSessionMessagesSlice,
} from "../support/messages";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import {
  defaultScenarioForRole,
  fromPersistedSessionRecord,
  historyToChatMessages,
  historyToSessionContextUsage,
} from "../support/persistence";
import { buildSessionHeaderMessages, buildSessionSystemPrompt } from "../support/session-prompt";
import {
  isTranscriptAgentSession,
  resolveAgentSessionPurposeForLoad,
} from "../support/session-purpose";
import { requiresLiveWorktreeRuntime } from "../support/session-runtime-attachment";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import { isSubagentMessage } from "../support/subagent-messages";
import {
  EMPTY_SUBAGENT_PENDING_PERMISSIONS_BY_SESSION_ID,
  mergeSubagentPendingPermissionOverlay,
  type SubagentPendingPermissionsBySessionId,
} from "../support/subagent-permission-overlay";
import {
  createHydrationRuntimeResolver,
  type ResolvedHydrationRuntime,
} from "./hydration-runtime-resolution";
import {
  LiveAgentSessionCache,
  liveAgentSessionLookupKey,
  RuntimeConnectionPreloadIndex,
} from "./live-agent-session-cache";
import type { LiveAgentSessionStore } from "./live-agent-session-store";
import { createReattachLiveSession } from "./reattach-live-session";

export type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type SessionLifecycleAdapter = Pick<
  AgentEnginePort,
  "hasSession" | "loadSessionHistory" | "resumeSession" | "attachSession"
> & {
  listLiveAgentSessionSnapshots?: AgentEnginePort["listLiveAgentSessionSnapshots"];
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
  readCurrentHydratedRuntimeResolution: (
    record: AgentSessionRecord,
  ) => Extract<ResolvedHydrationRuntime, { ok: true }> | null;
  resolveHydrationRuntime: (record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>;
  loadLiveAgentSessionSnapshot: (
    record: AgentSessionRecord,
    runtimeResolution: Extract<ResolvedHydrationRuntime, { ok: true }>,
  ) => Promise<LiveAgentSessionSnapshot | null>;
};

export type RuntimeResolutionPlannerStageInput = {
  intent: SessionLoadIntent;
  options?: AgentSessionLoadOptions;
  adapter: SessionLifecycleAdapter;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  liveAgentSessionStore?: LiveAgentSessionStore;
  recordsToHydrate: AgentSessionRecord[];
  historyHydrationSessionIds: Set<string>;
};

export type HydrationPromptAssembler = {
  buildHydrationPreludeMessages: (input: {
    record: AgentSessionRecord;
    resolvedScenario: AgentSessionState["scenario"];
    promptOverrides: RepoPromptOverrides;
  }) => Promise<AgentSessionState["messages"]>;
  buildHydrationSystemPrompt: (input: {
    record: AgentSessionRecord;
    resolvedScenario: AgentSessionState["scenario"];
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
  attachSessionListener?: (repoPath: string, sessionId: string) => void;
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

type VerifiedWorktreeRuntimeTarget = {
  workingDirectory: string;
  externalSessionIds: Set<string>;
};

const isRepoRootWorkspaceRuntime = (
  runtime: RuntimeInstanceSummary,
  normalizedRepoPath: string,
): boolean =>
  runtime.role === "workspace" &&
  normalizeWorkingDirectory(runtime.workingDirectory) === normalizedRepoPath;

const hasExactNonRepoRootWorkspaceRuntime = ({
  runtimes,
  workingDirectory,
  normalizedRepoPath,
}: {
  runtimes: RuntimeInstanceSummary[];
  workingDirectory: string;
  normalizedRepoPath: string;
}): boolean => {
  const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
  return runtimes.some(
    (runtime) =>
      normalizeWorkingDirectory(runtime.workingDirectory) === normalizedWorkingDirectory &&
      !isRepoRootWorkspaceRuntime(runtime, normalizedRepoPath),
  );
};

const getOrCreateVerifiedWorktreeRuntimeTarget = (
  targetsByWorkingDirectory: Map<string, VerifiedWorktreeRuntimeTarget>,
  workingDirectory: string,
): VerifiedWorktreeRuntimeTarget => {
  const key = normalizeWorkingDirectory(workingDirectory);
  const existing = targetsByWorkingDirectory.get(key);
  if (existing) {
    return existing;
  }

  const created = { workingDirectory: key, externalSessionIds: new Set<string>() };
  targetsByWorkingDirectory.set(key, created);
  return created;
};

const preloadVerifiedRepoRootRuntimeConnectionsForWorktreeSessions = async ({
  adapter,
  records,
  repoPath,
  runtimesByKind,
  preloadedRuntimeConnections,
  preloadedLiveAgentSessionsByKey,
}: {
  adapter: Pick<SessionLifecycleAdapter, "listLiveAgentSessionSnapshots">;
  records: AgentSessionRecord[];
  repoPath: string;
  runtimesByKind: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedRuntimeConnections: RuntimeConnectionPreloadIndex;
  preloadedLiveAgentSessionsByKey: Map<string, LiveAgentSessionSnapshot[]>;
}): Promise<void> => {
  if (!adapter.listLiveAgentSessionSnapshots) {
    return;
  }

  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  const targetsByRuntimeKind = new Map<RuntimeKind, Map<string, VerifiedWorktreeRuntimeTarget>>();
  for (const record of records) {
    const externalSessionId = record.externalSessionId ?? record.sessionId;
    const normalizedWorkingDirectory = normalizeWorkingDirectory(record.workingDirectory);
    if (
      !externalSessionId ||
      !requiresLiveWorktreeRuntime(record) ||
      normalizedWorkingDirectory === normalizedRepoPath
    ) {
      continue;
    }

    const runtimeKind = readPersistedRuntimeKind(record);
    const runtimes = runtimesByKind.get(runtimeKind) ?? [];
    if (
      hasExactNonRepoRootWorkspaceRuntime({
        runtimes,
        workingDirectory: record.workingDirectory,
        normalizedRepoPath,
      })
    ) {
      continue;
    }

    const targetsByWorkingDirectory =
      targetsByRuntimeKind.get(runtimeKind) ?? new Map<string, VerifiedWorktreeRuntimeTarget>();
    const target = getOrCreateVerifiedWorktreeRuntimeTarget(
      targetsByWorkingDirectory,
      record.workingDirectory,
    );
    target.externalSessionIds.add(externalSessionId);
    targetsByRuntimeKind.set(runtimeKind, targetsByWorkingDirectory);
  }

  for (const [runtimeKind, targetsByWorkingDirectory] of targetsByRuntimeKind) {
    const repoRootWorkspaceRuntimes = (runtimesByKind.get(runtimeKind) ?? []).filter((runtime) =>
      isRepoRootWorkspaceRuntime(runtime, normalizedRepoPath),
    );
    for (const runtime of repoRootWorkspaceRuntimes) {
      for (const target of targetsByWorkingDirectory.values()) {
        const runtimeConnection: AgentRuntimeConnection = runtimeRouteToConnection(
          runtime.runtimeRoute,
          target.workingDirectory,
        );
        const liveSessions = await adapter.listLiveAgentSessionSnapshots({
          runtimeKind,
          runtimeConnection,
          directories: [target.workingDirectory],
        });
        const liveSessionsForDirectory = liveSessions.filter(
          (session) =>
            normalizeWorkingDirectory(session.workingDirectory) === target.workingDirectory,
        );
        const hasMatchingSession = liveSessionsForDirectory.some((session) =>
          target.externalSessionIds.has(session.externalSessionId),
        );
        if (!hasMatchingSession) {
          continue;
        }

        preloadedRuntimeConnections.add(runtimeKind, runtimeConnection);
        preloadedLiveAgentSessionsByKey.set(
          liveAgentSessionLookupKey(runtimeKind, runtimeConnection, target.workingDirectory),
          liveSessionsForDirectory,
        );
      }
    }
  }
};
const normalizeLiveSessionTitle = (title: string | undefined): string | undefined => {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const readSubagentSessionIds = (
  sessionId: string,
  messages: AgentSessionState["messages"],
): string[] => {
  const sessionIds = new Set<string>();
  forEachSessionMessage({ sessionId, messages }, (message) => {
    if (!isSubagentMessage(message)) {
      return;
    }
    const subagentSessionId = message.meta.sessionId?.trim();
    if (subagentSessionId) {
      sessionIds.add(subagentSessionId);
    }
  });
  return Array.from(sessionIds);
};

type HydratedSubagentPendingPermissionOverlay = {
  scannedChildExternalSessionIds: string[];
  pendingPermissionsByChildExternalSessionId: SubagentPendingPermissionsBySessionId;
};

const EMPTY_HYDRATED_SUBAGENT_PENDING_PERMISSION_OVERLAY = Object.freeze({
  scannedChildExternalSessionIds: [],
  pendingPermissionsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_PERMISSIONS_BY_SESSION_ID,
}) satisfies HydratedSubagentPendingPermissionOverlay;

const toHydratedSubagentPendingPermissionOverlay = (
  scannedChildExternalSessionIds: string[],
  pendingPermissionsByChildExternalSessionId: SubagentPendingPermissionsBySessionId,
): HydratedSubagentPendingPermissionOverlay => {
  if (scannedChildExternalSessionIds.length === 0) {
    return EMPTY_HYDRATED_SUBAGENT_PENDING_PERMISSION_OVERLAY;
  }

  return {
    scannedChildExternalSessionIds,
    pendingPermissionsByChildExternalSessionId:
      Object.keys(pendingPermissionsByChildExternalSessionId).length > 0
        ? pendingPermissionsByChildExternalSessionId
        : EMPTY_SUBAGENT_PENDING_PERMISSIONS_BY_SESSION_ID,
  };
};

const loadHydratedSubagentPendingPermissionOverlay = async ({
  record,
  messages,
  runtimeResolution,
  runtimePlanner,
}: {
  record: AgentSessionRecord;
  messages: AgentSessionState["messages"];
  runtimeResolution: Extract<ResolvedHydrationRuntime, { ok: true }>;
  runtimePlanner: HydrationRuntimePlanner;
}): Promise<HydratedSubagentPendingPermissionOverlay> => {
  const childExternalSessionIds = readSubagentSessionIds(record.sessionId, messages);
  if (childExternalSessionIds.length === 0) {
    return EMPTY_HYDRATED_SUBAGENT_PENDING_PERMISSION_OVERLAY;
  }

  const pendingPermissionsByChildExternalSessionId: SubagentPendingPermissionsBySessionId = {};
  const scannedChildExternalSessionIds: string[] = [];
  await Promise.all(
    childExternalSessionIds.map(async (childExternalSessionId) => {
      try {
        const snapshot = await runtimePlanner.loadLiveAgentSessionSnapshot(
          {
            ...record,
            sessionId: childExternalSessionId,
            externalSessionId: childExternalSessionId,
          },
          runtimeResolution,
        );
        scannedChildExternalSessionIds.push(childExternalSessionId);
        if (snapshot && snapshot.pendingPermissions.length > 0) {
          pendingPermissionsByChildExternalSessionId[childExternalSessionId] =
            snapshot.pendingPermissions;
        }
      } catch (error) {
        console.warn(
          `Failed to hydrate pending permissions for subagent session '${childExternalSessionId}': ${errorMessage(error)}`,
        );
      }
    }),
  );

  return toHydratedSubagentPendingPermissionOverlay(
    scannedChildExternalSessionIds,
    pendingPermissionsByChildExternalSessionId,
  );
};

const mergePersistedSessionRecord = (
  current: AgentSessionState,
  record: AgentSessionRecord,
  taskId: string,
  repoPath: string,
  promptOverrides: RepoPromptOverrides,
  purpose: AgentSessionPurpose,
): AgentSessionState => {
  const persisted = fromPersistedSessionRecord(record, taskId, repoPath);
  const shouldPreserveCurrentWorkingDirectory = current.runtimeRoute !== null;
  const nextPurpose: AgentSessionPurpose = isTranscriptAgentSession(current)
    ? "transcript"
    : purpose;

  return {
    ...current,
    purpose: nextPurpose,
    repoPath: persisted.repoPath,
    externalSessionId: persisted.externalSessionId,
    taskId: persisted.taskId,
    role: persisted.role,
    scenario: persisted.scenario,
    startedAt: persisted.startedAt,
    workingDirectory: shouldPreserveCurrentWorkingDirectory
      ? current.workingDirectory
      : persisted.workingDirectory,
    pendingPermissions: current.pendingPermissions,
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
  const runtimeKind = session.runtimeKind ?? null;
  if (!runtimeKind) {
    return null;
  }

  return {
    sessionId: session.sessionId,
    externalSessionId: session.externalSessionId,
    role: session.role,
    scenario: session.scenario,
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

const toLiveSessionState = (
  status: LiveAgentSessionSnapshot["status"],
): AgentSessionState["status"] => {
  if (status.type === "busy" || status.type === "retry") {
    return "running";
  }
  return "idle";
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
          sessionId: record.sessionId,
          shouldHydrateRequestedSession: intent.shouldHydrateRequestedSession,
        });
        const existingSession = next[record.sessionId];
        if (existingSession) {
          next[record.sessionId] = mergePersistedSessionRecord(
            existingSession,
            record,
            intent.taskId,
            intent.repoPath,
            existingSession.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
            nextPurpose,
          );
          continue;
        }
        next[record.sessionId] = {
          ...fromPersistedSessionRecord(record, intent.taskId, intent.repoPath),
          purpose: nextPurpose,
          pendingPermissions: [],
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

  const recordsToHydrate =
    intent.requestedSessionId !== null &&
    (intent.shouldHydrateRequestedSession || intent.mode === "recover_runtime_attachment")
      ? persistedRecords.filter((record) => record.sessionId === intent.requestedSessionId)
      : persistedRecords;
  const historyHydrationSessionIds = new Set(
    recordsToHydrate
      .filter((record) => {
        if (intent.historyPolicy !== "requested_only") {
          return false;
        }
        return intent.requestedSessionId === null || record.sessionId === intent.requestedSessionId;
      })
      .map((record) => record.sessionId),
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
  sessionsRef,
  liveAgentSessionStore,
  recordsToHydrate,
  historyHydrationSessionIds,
}: RuntimeResolutionPlannerStageInput): Promise<HydrationRuntimePlanner> => {
  const readCurrentHydratedRuntimeResolution = (
    record: AgentSessionRecord,
  ): Extract<ResolvedHydrationRuntime, { ok: true }> | null => {
    const currentSession = sessionsRef.current[record.sessionId];
    const runtimeKind = currentSession?.runtimeKind ?? null;
    const runtimeRoute = currentSession?.runtimeRoute ?? null;
    const workingDirectory =
      currentSession?.workingDirectory.trim() || record.workingDirectory.trim();
    if (!runtimeKind || runtimeRoute === null || workingDirectory.length === 0) {
      return null;
    }

    return {
      ok: true,
      runtimeKind,
      runtimeId: currentSession?.runtimeId ?? null,
      runtimeRoute,
      runtimeConnection: runtimeRouteToConnection(runtimeRoute, workingDirectory),
    };
  };

  const recordsNeedingRuntimeResolution = recordsToHydrate.filter((record) => {
    if (!historyHydrationSessionIds.has(record.sessionId)) {
      return true;
    }
    return readCurrentHydratedRuntimeResolution(record) === null;
  });

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

  const ensuredWorkspaceRuntimes = new Map<RuntimeKind, RuntimeInstanceSummary | null>();

  const ensureWorkspaceRuntime = async (
    runtimeKind: RuntimeKind,
  ): Promise<RuntimeInstanceSummary | null> => {
    if (options?.allowRuntimeEnsure === false) {
      return null;
    }
    if (ensuredWorkspaceRuntimes.has(runtimeKind)) {
      return ensuredWorkspaceRuntimes.get(runtimeKind) ?? null;
    }
    const runtime = await ensureRuntimeAndInvalidateReadinessQueries({
      repoPath: intent.repoPath,
      runtimeKind,
      ensureRuntime: (repoPath, nextRuntimeKind) => host.runtimeEnsure(repoPath, nextRuntimeKind),
    });
    ensuredWorkspaceRuntimes.set(runtimeKind, runtime);
    return runtime;
  };

  const preloadedRuntimeConnections =
    options?.preloadedRuntimeConnections ?? new RuntimeConnectionPreloadIndex();
  const preloadedLiveAgentSessionsByKey =
    options?.preloadedLiveAgentSessionsByKey ?? new Map<string, LiveAgentSessionSnapshot[]>();

  await preloadVerifiedRepoRootRuntimeConnectionsForWorktreeSessions({
    adapter,
    records: recordsNeedingRuntimeResolution,
    repoPath: intent.repoPath,
    runtimesByKind,
    preloadedRuntimeConnections,
    preloadedLiveAgentSessionsByKey,
  });

  const resolveHydrationRuntime = createHydrationRuntimeResolver({
    repoPath: intent.repoPath,
    runtimesByKind,
    ...(preloadedRuntimeConnections.size > 0 ? { preloadedRuntimeConnections } : {}),
    ...(preloadedLiveAgentSessionsByKey.size > 0 ? { preloadedLiveAgentSessionsByKey } : {}),
    ensureWorkspaceRuntime,
  });
  const liveAgentSessionScanCache =
    adapter.listLiveAgentSessionSnapshots || preloadedLiveAgentSessionsByKey.size > 0
      ? new LiveAgentSessionCache(
          {
            listLiveAgentSessionSnapshots: async (input) => {
              if (!adapter.listLiveAgentSessionSnapshots) {
                throw new Error(
                  "Live agent session snapshots are unavailable for session scanning.",
                );
              }
              return adapter.listLiveAgentSessionSnapshots(input);
            },
          },
          preloadedLiveAgentSessionsByKey.size > 0 ? preloadedLiveAgentSessionsByKey : undefined,
        )
      : null;

  const loadLiveAgentSessionSnapshot = async (
    record: AgentSessionRecord,
    runtimeResolution: Extract<ResolvedHydrationRuntime, { ok: true }>,
  ): Promise<LiveAgentSessionSnapshot | null> => {
    const resolvedWorkingDirectory = runtimeResolution.runtimeConnection.workingDirectory;
    const externalSessionId = record.externalSessionId ?? record.sessionId;
    const storedSnapshot = liveAgentSessionStore?.readSnapshot({
      repoPath: intent.repoPath,
      runtimeKind: runtimeResolution.runtimeKind,
      runtimeConnection: runtimeResolution.runtimeConnection,
      workingDirectory: resolvedWorkingDirectory,
      externalSessionId,
    });
    if (storedSnapshot) {
      return storedSnapshot;
    }

    if (!liveAgentSessionScanCache) {
      throw new Error("Live agent session snapshots are unavailable for session hydration.");
    }
    const snapshots = await liveAgentSessionScanCache.load({
      runtimeKind: runtimeResolution.runtimeKind,
      runtimeConnection: runtimeResolution.runtimeConnection,
      directories: [resolvedWorkingDirectory],
    });
    return snapshots.find((snapshot) => snapshot.externalSessionId === externalSessionId) ?? null;
  };

  return {
    readCurrentHydratedRuntimeResolution,
    resolveHydrationRuntime,
    loadLiveAgentSessionSnapshot,
  };
};

export const createHydrationPromptAssemblerStage = ({
  taskId,
  taskRef,
  historyPreludeMode = "task_context",
}: PromptAssemblerStageInput): HydrationPromptAssembler => {
  const buildHydrationPreludeMessages = async ({
    record,
    resolvedScenario,
    promptOverrides,
  }: {
    record: AgentSessionRecord;
    resolvedScenario: AgentSessionState["scenario"];
    promptOverrides: RepoPromptOverrides;
  }): Promise<AgentSessionState["messages"]> => {
    if (historyPreludeMode === "none") {
      return [];
    }
    const task = taskRef.current.find((entry) => entry.id === taskId);
    if (!task) {
      return buildSessionHeaderMessages({
        sessionId: record.sessionId,
        role: record.role,
        scenario: resolvedScenario,
        systemPrompt: "",
        startedAt: record.startedAt,
        includeSystemPrompt: false,
      });
    }

    const systemPrompt = buildSessionSystemPrompt({
      role: record.role,
      scenario: resolvedScenario,
      task,
      promptOverrides,
    });

    return buildSessionHeaderMessages({
      sessionId: record.sessionId,
      role: record.role,
      scenario: resolvedScenario,
      systemPrompt,
      startedAt: record.startedAt,
    });
  };

  const buildHydrationSystemPrompt = async ({
    record,
    resolvedScenario,
    promptOverrides,
  }: {
    record: AgentSessionRecord;
    resolvedScenario: AgentSessionState["scenario"];
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
      scenario: resolvedScenario,
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
  if (!adapter.listLiveAgentSessionSnapshots) {
    throw new Error(
      "Live agent session snapshots are unavailable for live session reconciliation.",
    );
  }

  const runtimeSessionScanCache = new LiveAgentSessionCache(
    {
      listLiveAgentSessionSnapshots: async (input) => {
        if (!adapter.listLiveAgentSessionSnapshots) {
          throw new Error("Live agent session snapshots are unavailable for session scanning.");
        }
        return adapter.listLiveAgentSessionSnapshots(input);
      },
    },
    options?.preloadedLiveAgentSessionsByKey,
  );
  const maybeResumeLiveRecord = createReattachLiveSession({
    adapter,
    repoPath: intent.repoPath,
    updateSession,
    ...(attachSessionListener ? { attachSessionListener } : {}),
    promptOverrides: EMPTY_PROMPT_OVERRIDES,
    resolveHydrationRuntime: runtimePlanner.resolveHydrationRuntime,
    listLiveAgentSessions: (runtimeKind, runtimeConnection, directories) =>
      runtimeSessionScanCache.load({
        runtimeKind,
        runtimeConnection,
        directories,
      }),
    attachMissingLiveSession: async ({ record, runtimeKind, runtimeConnection }) => {
      const promptOverrides = await getRepoPromptOverrides();
      if (isStaleRepoOperation()) {
        return;
      }
      const resolvedScenario = record.scenario ?? defaultScenarioForRole(record.role);
      const selectedModel = normalizePersistedSelection(record.selectedModel);
      const systemPrompt = await promptAssembler.buildHydrationSystemPrompt({
        record,
        resolvedScenario,
        promptOverrides,
      });
      if (isStaleRepoOperation()) {
        return;
      }

      const attachInput = {
        sessionId: record.sessionId,
        externalSessionId: record.externalSessionId ?? record.sessionId,
        repoPath: intent.repoPath,
        runtimeKind,
        runtimeConnection,
        workingDirectory: runtimeConnection.workingDirectory,
        taskId: intent.taskId,
        role: record.role,
        scenario: resolvedScenario,
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
    toLiveSessionState,
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
        reattachedSessionIds.add(record.sessionId);
        continue;
      }
      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          pendingPermissions: [],
          pendingQuestions: [],
        }),
        { persist: false },
      );
    }
  }

  return { reattachedSessionIds };
};

export const hydrateSessionRecordsStage = async ({
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

  if (historyHydrationSessionIds.size > 0) {
    setSessionsById((current) => {
      const next = { ...current };
      for (const sessionId of historyHydrationSessionIds) {
        const existingSession = next[sessionId];
        if (!existingSession) {
          continue;
        }
        next[sessionId] = {
          ...existingSession,
          historyHydrationState: "hydrating",
        };
      }
      return next;
    });
  }

  const hydrateRecord = async (record: AgentSessionRecord): Promise<void> => {
    if (isStaleRepoOperation()) {
      return;
    }

    const shouldHydrateHistory = historyHydrationSessionIds.has(record.sessionId);
    const runtimeResolution =
      (shouldHydrateHistory ? runtimePlanner.readCurrentHydratedRuntimeResolution(record) : null) ??
      (await runtimePlanner.resolveHydrationRuntime(record));
    if (isStaleRepoOperation()) {
      return;
    }
    if (!runtimeResolution.ok) {
      if (shouldHydrateHistory) {
        updateSession(
          record.sessionId,
          (current) => ({
            ...current,
            historyHydrationState: "failed",
          }),
          { persist: false },
        );
        throw new Error(runtimeResolution.reason);
      }
      if (failOnRuntimeResolutionError) {
        throw new Error(runtimeResolution.reason);
      }
      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          runtimeKind: readPersistedRuntimeKind(record),
          runtimeId: null,
          runtimeRoute: null,
          workingDirectory: record.workingDirectory,
          promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
        }),
        { persist: false },
      );
      return;
    }

    const { runtimeKind, runtimeId, runtimeRoute, runtimeConnection } = runtimeResolution;
    const workingDirectory = runtimeConnection.workingDirectory;
    if (!shouldHydrateHistory) {
      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          runtimeKind,
          runtimeId,
          runtimeRoute,
          workingDirectory,
          promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
        }),
        { persist: false },
      );
      return;
    }

    const promptOverrides = await getRepoPromptOverrides();
    const resolvedScenario = record.scenario ?? defaultScenarioForRole(record.role);
    const preludeMessages = await promptAssembler.buildHydrationPreludeMessages({
      record,
      resolvedScenario,
      promptOverrides,
    });
    const history = await adapter.loadSessionHistory({
      runtimeKind,
      runtimeConnection,
      externalSessionId: record.externalSessionId ?? record.sessionId,
      limit: INITIAL_SESSION_HISTORY_LIMIT,
    });
    const liveRuntimeSnapshot = await runtimePlanner.loadLiveAgentSessionSnapshot(
      record,
      runtimeResolution,
    );
    const liveSessionStatus = liveRuntimeSnapshot
      ? toLiveSessionState(liveRuntimeSnapshot.status)
      : null;
    const livePendingPermissions = liveRuntimeSnapshot?.pendingPermissions ?? [];
    const livePendingQuestions = liveRuntimeSnapshot?.pendingQuestions ?? [];
    const selectedModel = normalizePersistedSelection(record.selectedModel);
    const liveSessionTitle = normalizeLiveSessionTitle(liveRuntimeSnapshot?.title);
    const hydratedMessages = createSessionMessagesState(record.sessionId, [
      ...getSessionMessagesSlice({ sessionId: record.sessionId, messages: preludeMessages }, 0),
      ...historyToChatMessages(history, {
        role: record.role,
        selectedModel,
      }),
    ]);
    const hydratedSubagentPendingPermissionsBySessionId =
      await loadHydratedSubagentPendingPermissionOverlay({
        record,
        messages: hydratedMessages,
        runtimeResolution,
        runtimePlanner,
      });
    if (isStaleRepoOperation()) {
      return;
    }

    updateSession(
      record.sessionId,
      (current) => {
        const nextSession: AgentSessionState = {
          ...current,
          runtimeKind,
          runtimeId,
          runtimeRoute,
          status: liveSessionStatus ?? current.status,
          workingDirectory,
          historyHydrationState: "hydrated",
          runtimeRecoveryState: "idle",
          promptOverrides,
          pendingPermissions: livePendingPermissions,
          pendingQuestions: livePendingQuestions,
          subagentPendingPermissionsBySessionId: mergeSubagentPendingPermissionOverlay({
            current: current.subagentPendingPermissionsBySessionId,
            scannedChildExternalSessionIds:
              hydratedSubagentPendingPermissionsBySessionId.scannedChildExternalSessionIds,
            pendingPermissionsByChildExternalSessionId:
              hydratedSubagentPendingPermissionsBySessionId.pendingPermissionsByChildExternalSessionId,
          }),
          contextUsage: historyToSessionContextUsage(history, selectedModel),
          messages: mergeHydratedMessages(current.sessionId, hydratedMessages, current.messages),
        };
        if (liveRuntimeSnapshot) {
          if (liveSessionTitle) {
            nextSession.title = liveSessionTitle;
          } else {
            delete nextSession.title;
          }
        }
        return nextSession;
      },
      { persist: false },
    );
  };

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
        hydrateRecord(record).catch((error) => {
          if (historyHydrationSessionIds.has(record.sessionId)) {
            updateSession(
              record.sessionId,
              (current) => ({
                ...current,
                historyHydrationState: "failed",
              }),
              { persist: false },
            );
          }
          throw error;
        }),
      ),
    );
  }
};
