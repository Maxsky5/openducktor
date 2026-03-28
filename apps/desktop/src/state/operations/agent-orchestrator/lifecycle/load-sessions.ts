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
import { appQueryClient } from "@/lib/query-client";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import { loadRuntimeListFromQuery, runtimeQueryKeys } from "@/state/queries/runtime";
import { loadRepoRunsFromQuery } from "@/state/queries/tasks";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import type { TaskDocuments } from "../runtime/runtime";
import { createRepoStaleGuard } from "../support/core";
import { DEFAULT_AGENT_SESSION_HISTORY_HYDRATION_STATE } from "../support/history-hydration";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import {
  defaultScenarioForRole,
  fromPersistedSessionRecord,
  historyToChatMessages,
  historyToSessionContextUsage,
} from "../support/persistence";
import { buildSessionHeaderMessages, buildSessionSystemPrompt } from "../support/session-prompt";
import {
  createHydrationRuntimeResolver,
  readPersistedRuntimeKind,
} from "./hydration-runtime-resolution";
import { LiveAgentSessionCache, liveAgentSessionLookupKey } from "./live-agent-session-cache";
import type { LiveAgentSessionStore } from "./live-agent-session-store";
import { createReattachLiveSession } from "./reattach-live-session";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionLifecycleAdapter = Pick<
  AgentEnginePort,
  "hasSession" | "loadSessionHistory" | "resumeSession" | "listLiveAgentSessionSnapshots"
> & {
  listLiveAgentSessionSnapshots?: AgentEnginePort["listLiveAgentSessionSnapshots"];
};

const INITIAL_SESSION_HISTORY_LIMIT = 600;
const SESSION_HISTORY_HYDRATION_CONCURRENCY = 3;
const EMPTY_PROMPT_OVERRIDES: RepoPromptOverrides = {};

type HydrationRuntimeResolution =
  | {
      ok: true;
      runtimeKind: RuntimeKind;
      runtimeId: string | null;
      runId: string | null;
      runtimeEndpoint: string;
      runtimeConnection: AgentRuntimeConnection;
    }
  | {
      ok: false;
      runtimeKind: RuntimeKind;
      reason: string;
    };

const mergePersistedSessionRecord = (
  current: AgentSessionState,
  record: AgentSessionRecord,
  taskId: string,
  promptOverrides: RepoPromptOverrides,
): AgentSessionState => {
  const persisted = fromPersistedSessionRecord(record, taskId);

  return {
    ...current,
    externalSessionId: persisted.externalSessionId,
    taskId: persisted.taskId,
    role: persisted.role,
    scenario: persisted.scenario,
    startedAt: persisted.startedAt,
    workingDirectory: persisted.workingDirectory,
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

const toRequestedHistoryRecordFromSession = (
  session: AgentSessionState,
): AgentSessionRecord | null => {
  const runtimeKind = session.runtimeKind ?? session.selectedModel?.runtimeKind ?? null;
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

type CreateLoadAgentSessionsArgs = {
  activeRepo: string | null;
  adapter: SessionLifecycleAdapter;
  repoEpochRef: MutableRefObject<number>;
  activeRepoRef?: MutableRefObject<string | null>;
  previousRepoRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  taskRef: MutableRefObject<TaskCard[]>;
  updateSession: UpdateSession;
  attachSessionListener?: (repoPath: string, sessionId: string) => void;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
  loadTaskDocuments?: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  liveAgentSessionStore?: LiveAgentSessionStore;
};

export const createLoadAgentSessions = ({
  activeRepo,
  adapter,
  repoEpochRef,
  activeRepoRef,
  previousRepoRef,
  sessionsRef,
  setSessionsById,
  taskRef,
  updateSession,
  attachSessionListener,
  loadRepoPromptOverrides,
  loadTaskDocuments: _loadTaskDocuments,
  liveAgentSessionStore,
}: CreateLoadAgentSessionsArgs): ((
  taskId: string,
  options?: AgentSessionLoadOptions,
) => Promise<void>) => {
  const inFlightRequestedHistoryLoads = new Map<string, Promise<void>>();

  const buildRequestedHistoryKey = (repoPath: string, taskId: string, sessionId: string): string =>
    `${repoPath}::${taskId}::${sessionId}`;

  return async (taskId: string, options?: AgentSessionLoadOptions): Promise<void> => {
    if (!activeRepo || taskId.trim().length === 0) {
      return;
    }

    const repoPath = activeRepo;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      activeRepoRef,
      previousRepoRef,
    });
    if (isStaleRepoOperation()) {
      return;
    }

    const mode = options?.mode ?? "bootstrap";
    const requestedSessionId = options?.targetSessionId?.trim() || null;
    const shouldHydrateRequestedSession =
      mode === "requested_history" && requestedSessionId !== null;
    const requestedHistoryKey = shouldHydrateRequestedSession
      ? buildRequestedHistoryKey(repoPath, taskId, requestedSessionId)
      : null;
    if (requestedHistoryKey) {
      const existingLoad = inFlightRequestedHistoryLoads.get(requestedHistoryKey);
      if (existingLoad) {
        await existingLoad;
        return;
      }
    }

    const executeLoad = async (): Promise<void> => {
      const currentRequestedSession = requestedSessionId
        ? (sessionsRef.current[requestedSessionId] ?? null)
        : null;
      const requestedHistoryRecordFromSession =
        shouldHydrateRequestedSession &&
        options?.persistedRecords === undefined &&
        currentRequestedSession &&
        currentRequestedSession.taskId === taskId
          ? toRequestedHistoryRecordFromSession(currentRequestedSession)
          : null;
      const shouldSkipPersistedSessionReload = requestedHistoryRecordFromSession !== null;

      const persisted = shouldSkipPersistedSessionReload
        ? [requestedHistoryRecordFromSession]
        : await (options?.persistedRecords
            ? Promise.resolve(options.persistedRecords)
            : loadAgentSessionListFromQuery(appQueryClient, repoPath, taskId));
      if (isStaleRepoOperation()) {
        return;
      }
      let repoPromptOverridesPromise: Promise<RepoPromptOverrides> | null = null;
      const getRepoPromptOverrides = (): Promise<RepoPromptOverrides> => {
        if (repoPromptOverridesPromise === null) {
          repoPromptOverridesPromise = loadRepoPromptOverrides(repoPath);
        }
        return repoPromptOverridesPromise;
      };

      const shouldReconcileLiveSessions = mode === "reconcile_live";
      const historyPolicy =
        options?.historyPolicy ??
        (shouldHydrateRequestedSession
          ? "requested_only"
          : shouldReconcileLiveSessions
            ? "live_if_empty"
            : "none");

      if (!shouldSkipPersistedSessionReload) {
        setSessionsById((current) => {
          if (isStaleRepoOperation()) {
            return current;
          }
          const next = { ...current };
          for (const record of persisted) {
            const existingSession = next[record.sessionId];
            if (existingSession) {
              next[record.sessionId] = mergePersistedSessionRecord(
                existingSession,
                record,
                taskId,
                existingSession.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
              );
              continue;
            }
            next[record.sessionId] = {
              ...fromPersistedSessionRecord(record, taskId),
              pendingPermissions: [],
              pendingQuestions: [],
              promptOverrides: EMPTY_PROMPT_OVERRIDES,
            };
          }
          return next;
        });
      }

      if (isStaleRepoOperation()) {
        return;
      }

      if (!shouldHydrateRequestedSession && !shouldReconcileLiveSessions) {
        return;
      }

      const recordsToHydrate = shouldHydrateRequestedSession
        ? persisted.filter((record) => record.sessionId === requestedSessionId)
        : persisted;

      const historyHydrationSessionIds = new Set(
        recordsToHydrate
          .filter((record) => {
            if (historyPolicy !== "requested_only") {
              return false;
            }
            return requestedSessionId === null || record.sessionId === requestedSessionId;
          })
          .map((record) => record.sessionId),
      );

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

      const readCurrentHydratedRuntimeResolution = (
        record: AgentSessionRecord,
      ): Extract<HydrationRuntimeResolution, { ok: true }> | null => {
        const currentSession = sessionsRef.current[record.sessionId];
        const runtimeKind = currentSession?.runtimeKind ?? null;
        const runtimeEndpoint = currentSession?.runtimeEndpoint.trim() ?? "";
        const workingDirectory =
          currentSession?.workingDirectory.trim() || record.workingDirectory.trim();
        if (!runtimeKind || runtimeEndpoint.length === 0 || workingDirectory.length === 0) {
          return null;
        }

        return {
          ok: true,
          runtimeKind,
          runtimeId: currentSession?.runtimeId ?? null,
          runId: currentSession?.runId ?? null,
          runtimeEndpoint,
          runtimeConnection: {
            endpoint: runtimeEndpoint,
            workingDirectory,
          },
        };
      };

      const loadLiveLiveAgentSessionSnapshot = async (
        record: AgentSessionRecord,
        runtimeResolution: Extract<HydrationRuntimeResolution, { ok: true }>,
      ): Promise<LiveAgentSessionSnapshot | null> => {
        const externalSessionId = record.externalSessionId ?? record.sessionId;
        const storedSnapshot = liveAgentSessionStore?.readSnapshot({
          repoPath,
          runtimeKind: runtimeResolution.runtimeKind,
          runtimeEndpoint: runtimeResolution.runtimeEndpoint,
          workingDirectory: record.workingDirectory,
          externalSessionId,
        });
        if (storedSnapshot) {
          return storedSnapshot;
        }

        const preloadedSnapshots = options?.preloadedLiveAgentSessionsByKey?.get(
          liveAgentSessionLookupKey(
            runtimeResolution.runtimeKind,
            runtimeResolution.runtimeEndpoint,
            record.workingDirectory,
          ),
        );
        if (preloadedSnapshots) {
          return (
            preloadedSnapshots.find(
              (snapshot) => snapshot.externalSessionId === externalSessionId,
            ) ?? null
          );
        }
        if (!adapter.listLiveAgentSessionSnapshots) {
          throw new Error("Live agent session snapshots are unavailable for session hydration.");
        }
        const snapshots = await adapter.listLiveAgentSessionSnapshots({
          runtimeKind: runtimeResolution.runtimeKind,
          runtimeConnection: runtimeResolution.runtimeConnection,
          directories: [record.workingDirectory],
        });
        return (
          snapshots.find((snapshot) => snapshot.externalSessionId === externalSessionId) ?? null
        );
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
                repoPath,
              );
              return [runtimeKind, runtimes] as const;
            }),
          ),
        );

      const requiresRunInspection = recordsNeedingRuntimeResolution.some(
        (record) => record.role === "build" || record.role === "qa",
      );
      const liveRuns = requiresRunInspection
        ? (options?.preloadedRuns ?? (await loadRepoRunsFromQuery(appQueryClient, repoPath)))
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
        const runtime = await host.runtimeEnsure(repoPath, runtimeKind);
        ensuredWorkspaceRuntimes.set(runtimeKind, runtime);
        await appQueryClient.invalidateQueries({
          queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
          exact: true,
          refetchType: "none",
        });
        return runtime;
      };

      const resolveHydrationRuntime = createHydrationRuntimeResolver({
        repoPath,
        liveRuns,
        runtimesByKind,
        ...(options?.preloadedRuntimeConnectionsByKey
          ? { preloadedRuntimeConnectionsByKey: options.preloadedRuntimeConnectionsByKey }
          : {}),
        ensureWorkspaceRuntime,
      });

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

      if (shouldReconcileLiveSessions && !adapter.listLiveAgentSessionSnapshots) {
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
        repoPath,
        taskId,
        taskRef,
        sessionsRef,
        updateSession,
        ...(attachSessionListener ? { attachSessionListener } : {}),
        promptOverrides: EMPTY_PROMPT_OVERRIDES,
        resolveHydrationRuntime,
        listLiveAgentSessions: (runtimeKind, runtimeConnection, directories) =>
          runtimeSessionScanCache.load({
            runtimeKind,
            runtimeConnection,
            directories,
          }),
        resumeMissingLiveSession: async ({ record, runtimeKind, runtimeConnection }) => {
          const promptOverrides = await getRepoPromptOverrides();
          const resolvedScenario = record.scenario ?? defaultScenarioForRole(record.role);
          const selectedModel = normalizePersistedSelection(record.selectedModel);
          const systemPrompt = await buildHydrationSystemPrompt({
            record,
            resolvedScenario,
            promptOverrides,
          });

          await adapter.resumeSession({
            sessionId: record.sessionId,
            externalSessionId: record.externalSessionId ?? record.sessionId,
            repoPath,
            runtimeKind,
            runtimeConnection,
            workingDirectory: runtimeConnection.workingDirectory,
            taskId,
            role: record.role,
            scenario: resolvedScenario,
            systemPrompt,
            ...(selectedModel ? { model: selectedModel } : {}),
          });
        },
        isStaleRepoOperation,
        toLiveSessionState,
      });

      if (shouldReconcileLiveSessions) {
        for (
          let offset = 0;
          offset < recordsToHydrate.length;
          offset += SESSION_HISTORY_HYDRATION_CONCURRENCY
        ) {
          if (isStaleRepoOperation()) {
            return;
          }
          const batch = recordsToHydrate.slice(
            offset,
            offset + SESSION_HISTORY_HYDRATION_CONCURRENCY,
          );
          const reattachResults = await Promise.all(
            batch.map(async (record) => ({
              record,
              reattached: await maybeResumeLiveRecord(record),
            })),
          );
          if (isStaleRepoOperation()) {
            return;
          }
          for (const { record, reattached } of reattachResults) {
            if (reattached) {
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
      }

      const hydrateRecord = async (record: AgentSessionRecord): Promise<void> => {
        if (isStaleRepoOperation()) {
          return;
        }

        const shouldHydrateHistory = historyHydrationSessionIds.has(record.sessionId);
        const workingDirectory = record.workingDirectory;
        const runtimeResolution =
          (shouldHydrateHistory ? readCurrentHydratedRuntimeResolution(record) : null) ??
          (await resolveHydrationRuntime(record));
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
              runtimeEndpoint: "",
              workingDirectory,
              promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
            }),
            { persist: false },
          );
          return;
        }
        const { runtimeKind, runtimeId, runId, runtimeEndpoint } = runtimeResolution;
        const externalSessionId = record.externalSessionId ?? record.sessionId;
        if (!shouldHydrateHistory) {
          updateSession(
            record.sessionId,
            (current) => ({
              ...current,
              runtimeKind,
              runtimeId,
              runId,
              runtimeEndpoint,
              workingDirectory,
              promptOverrides: current.promptOverrides ?? EMPTY_PROMPT_OVERRIDES,
            }),
            { persist: false },
          );
          return;
        }

        const promptOverrides = await getRepoPromptOverrides();
        const preludeMessages = await buildHydrationPreludeMessages({
          record,
          resolvedScenario: record.scenario ?? defaultScenarioForRole(record.role),
          promptOverrides,
        });
        const history = await adapter.loadSessionHistory({
          runtimeKind: runtimeResolution.runtimeKind,
          runtimeConnection: runtimeResolution.runtimeConnection,
          externalSessionId,
          limit: INITIAL_SESSION_HISTORY_LIMIT,
        });
        const liveRuntimeSnapshot = await loadLiveLiveAgentSessionSnapshot(
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
            return {
              ...current,
              runtimeKind,
              runtimeId,
              runId,
              runtimeEndpoint,
              status: liveSessionStatus ?? current.status,
              workingDirectory,
              historyHydrationState: "hydrated",
              promptOverrides,
              pendingPermissions: livePendingPermissions,
              pendingQuestions: livePendingQuestions,
              contextUsage: historyToSessionContextUsage(history, selectedModel),
              messages: [
                ...preludeMessages,
                ...historyToChatMessages(history, {
                  role: record.role,
                  selectedModel,
                }),
              ],
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
        const batch = recordsToHydrate.slice(
          offset,
          offset + SESSION_HISTORY_HYDRATION_CONCURRENCY,
        );
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

    if (!requestedHistoryKey) {
      await executeLoad();
      return;
    }

    const inFlightLoad = executeLoad().finally(() => {
      inFlightRequestedHistoryLoads.delete(requestedHistoryKey);
    });
    inFlightRequestedHistoryLoads.set(requestedHistoryKey, inFlightLoad);
    await inFlightLoad;
  };
};
