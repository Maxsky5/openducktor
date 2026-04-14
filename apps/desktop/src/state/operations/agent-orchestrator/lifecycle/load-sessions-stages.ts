import type {
  AgentSessionRecord,
  RepoPromptOverrides,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentEnginePort, LiveAgentSessionSnapshot } from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { appQueryClient } from "@/lib/query-client";
import { loadRuntimeListFromQuery, runtimeQueryKeys } from "@/state/queries/runtime";
import { loadRepoRunsFromQuery } from "@/state/queries/tasks";
import type {
  AgentSessionHistoryHydrationPolicy,
  AgentSessionLoadMode,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import { requireRuntimeConnectionSupport, runtimeRouteToConnection } from "../runtime/runtime";
import { DEFAULT_AGENT_SESSION_HISTORY_HYDRATION_STATE } from "../support/history-hydration";
import {
  appendSessionMessage,
  createSessionMessagesState,
  findSessionMessageById,
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
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import {
  createHydrationRuntimeResolver,
  type ResolvedHydrationRuntime,
} from "./hydration-runtime-resolution";
import { LiveAgentSessionCache, liveAgentSessionLookupKey } from "./live-agent-session-cache";
import type { LiveAgentSessionStore } from "./live-agent-session-store";
import { createReattachLiveSession } from "./reattach-live-session";

export type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type SessionLifecycleAdapter = Pick<
  AgentEnginePort,
  "hasSession" | "loadSessionHistory" | "resumeSession"
> & {
  listLiveAgentSessionSnapshots?: AgentEnginePort["listLiveAgentSessionSnapshots"];
};

export type SessionLoadIntent = {
  repoPath: string;
  taskId: string;
  mode: AgentSessionLoadMode;
  requestedSessionId: string | null;
  requestedHistoryKey: string | null;
  shouldHydrateRequestedSession: boolean;
  shouldReconcileLiveSessions: boolean;
  historyPolicy: AgentSessionHistoryHydrationPolicy;
};

export type PersistedSessionMergeStageInput = {
  intent: SessionLoadIntent;
  options?: AgentSessionLoadOptions;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  isStaleRepoOperation: () => boolean;
  loadPersistedRecords: () => Promise<AgentSessionRecord[]>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
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
  runtimePlanner: HydrationRuntimePlanner;
  promptAssembler: HydrationPromptAssembler;
  getRepoPromptOverrides: () => Promise<RepoPromptOverrides>;
};

const INITIAL_SESSION_HISTORY_LIMIT = 600;
const SESSION_HISTORY_HYDRATION_CONCURRENCY = 3;
const EMPTY_PROMPT_OVERRIDES: RepoPromptOverrides = {};

const mergePersistedSessionRecord = (
  current: AgentSessionState,
  record: AgentSessionRecord,
  taskId: string,
  promptOverrides: RepoPromptOverrides,
): AgentSessionState => {
  const persisted = fromPersistedSessionRecord(record, taskId);
  const shouldPreserveCurrentWorkingDirectory = current.runtimeRoute !== null;

  return {
    ...current,
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
    promptOverrides,
  };
};

export const mergeHydratedMessages = (
  sessionId: string,
  hydratedMessages: AgentSessionState["messages"],
  currentMessages: AgentSessionState["messages"],
): AgentSessionState["messages"] => {
  const currentOwner = { sessionId, messages: currentMessages };
  const mergeSameMessageId = (
    hydratedMessage: import("@/types/agent-orchestrator").AgentChatMessage,
    currentMessage: import("@/types/agent-orchestrator").AgentChatMessage | undefined,
  ) => {
    if (!currentMessage) {
      return hydratedMessage;
    }

    const hydratedIsQueuedUser =
      hydratedMessage.role === "user" &&
      hydratedMessage.meta?.kind === "user" &&
      hydratedMessage.meta.state === "queued";
    const currentIsQueuedUser =
      currentMessage.role === "user" &&
      currentMessage.meta?.kind === "user" &&
      currentMessage.meta.state === "queued";

    if (currentIsQueuedUser && !hydratedIsQueuedUser) {
      const mergedMeta =
        currentMessage.meta && hydratedMessage.meta
          ? { ...currentMessage.meta, ...hydratedMessage.meta }
          : (hydratedMessage.meta ?? currentMessage.meta);
      return {
        ...currentMessage,
        ...hydratedMessage,
        ...(mergedMeta ? { meta: mergedMeta } : {}),
      };
    }

    return currentMessage;
  };
  const hydratedOwner = { sessionId, messages: hydratedMessages };
  const hydratedMessageIds = new Set<string>();
  let mergedMessages = createSessionMessagesState(sessionId);

  forEachSessionMessage(hydratedOwner, (message) => {
    hydratedMessageIds.add(message.id);
    mergedMessages = appendSessionMessage(
      { sessionId, messages: mergedMessages },
      mergeSameMessageId(message, findSessionMessageById(currentOwner, message.id)),
    );
  });

  forEachSessionMessage(currentOwner, (message) => {
    if (hydratedMessageIds.has(message.id)) {
      return;
    }
    mergedMessages = appendSessionMessage({ sessionId, messages: mergedMessages }, message);
  });

  return mergedMessages;
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
      repoPromptOverridesPromise = loadRepoPromptOverrides(intent.repoPath);
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
        const existingSession = next[record.sessionId];
        if (existingSession) {
          next[record.sessionId] = mergePersistedSessionRecord(
            existingSession,
            record,
            intent.taskId,
            existingSession.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
          );
          continue;
        }
        next[record.sessionId] = {
          ...fromPersistedSessionRecord(record, intent.taskId),
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

  const recordsToHydrate = intent.shouldHydrateRequestedSession
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
      runId: currentSession?.runId ?? null,
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

  const requiresRunInspection = recordsNeedingRuntimeResolution.some(
    (record) => record.role === "build" || record.role === "qa",
  );
  const liveRuns = requiresRunInspection
    ? (options?.preloadedRuns ?? (await loadRepoRunsFromQuery(appQueryClient, intent.repoPath)))
    : [];
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
    const runtime = await host.runtimeEnsure(intent.repoPath, runtimeKind);
    ensuredWorkspaceRuntimes.set(runtimeKind, runtime);
    await appQueryClient.invalidateQueries({
      queryKey: runtimeQueryKeys.list(runtimeKind, intent.repoPath),
      exact: true,
      refetchType: "none",
    });
    return runtime;
  };

  const resolveHydrationRuntime = createHydrationRuntimeResolver({
    repoPath: intent.repoPath,
    liveRuns,
    runtimesByKind,
    ...(options?.preloadedRuntimeConnectionsByKey
      ? { preloadedRuntimeConnectionsByKey: options.preloadedRuntimeConnectionsByKey }
      : {}),
    ensureWorkspaceRuntime,
  });

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

    const preloadedSnapshots = options?.preloadedLiveAgentSessionsByKey?.get(
      liveAgentSessionLookupKey(
        runtimeResolution.runtimeKind,
        runtimeResolution.runtimeConnection,
        resolvedWorkingDirectory,
      ),
    );
    if (preloadedSnapshots) {
      return (
        preloadedSnapshots.find((snapshot) => snapshot.externalSessionId === externalSessionId) ??
        null
      );
    }
    if (!adapter.listLiveAgentSessionSnapshots) {
      throw new Error("Live agent session snapshots are unavailable for session hydration.");
    }
    const snapshots = await adapter.listLiveAgentSessionSnapshots({
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
    resumeMissingLiveSession: async ({ record, runtimeKind, runtimeConnection }) => {
      const supportedRuntimeConnection = requireRuntimeConnectionSupport(
        runtimeKind,
        runtimeConnection,
        "resume session",
      );
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

      await adapter.resumeSession({
        sessionId: record.sessionId,
        externalSessionId: record.externalSessionId ?? record.sessionId,
        repoPath: intent.repoPath,
        runtimeKind,
        runtimeConnection: supportedRuntimeConnection,
        workingDirectory: supportedRuntimeConnection.workingDirectory,
        taskId: intent.taskId,
        role: record.role,
        scenario: resolvedScenario,
        systemPrompt,
        ...(selectedModel ? { model: selectedModel } : {}),
      });
    },
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
      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          runtimeKind: readPersistedRuntimeKind(record),
          runtimeId: null,
          runId: null,
          runtimeRoute: null,
          workingDirectory: record.workingDirectory,
          promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
        }),
        { persist: false },
      );
      return;
    }

    const { runtimeKind, runtimeId, runId, runtimeRoute, runtimeConnection } = runtimeResolution;
    const workingDirectory = runtimeConnection.workingDirectory;
    if (!shouldHydrateHistory) {
      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          runtimeKind,
          runtimeId,
          runId,
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
    const supportedRuntimeConnection = requireRuntimeConnectionSupport(
      runtimeKind,
      runtimeConnection,
      "load session history",
    );
    const history = await adapter.loadSessionHistory({
      runtimeKind,
      runtimeConnection: supportedRuntimeConnection,
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
    if (isStaleRepoOperation()) {
      return;
    }

    updateSession(
      record.sessionId,
      (current) => {
        const selectedModel = normalizePersistedSelection(record.selectedModel);
        const hydratedMessages = createSessionMessagesState(record.sessionId, [
          ...getSessionMessagesSlice({ sessionId: record.sessionId, messages: preludeMessages }, 0),
          ...historyToChatMessages(history, {
            role: record.role,
            selectedModel,
          }),
        ]);
        return {
          ...current,
          runtimeKind,
          runtimeId,
          runId,
          runtimeRoute,
          status: liveSessionStatus ?? current.status,
          workingDirectory,
          historyHydrationState: "hydrated",
          promptOverrides,
          pendingPermissions: livePendingPermissions,
          pendingQuestions: livePendingQuestions,
          contextUsage: historyToSessionContextUsage(history, selectedModel),
          messages: mergeHydratedMessages(current.sessionId, hydratedMessages, current.messages),
        };
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
