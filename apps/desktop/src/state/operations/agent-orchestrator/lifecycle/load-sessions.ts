import type {
  AgentSessionRecord,
  RepoPromptOverrides,
  RunSummary,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentEnginePort, AgentRuntimeConnection } from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { appQueryClient } from "@/lib/query-client";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import { loadRuntimeListFromQuery, runtimeQueryKeys } from "@/state/queries/runtime";
import { loadRepoRunsFromQuery } from "@/state/queries/tasks";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import {
  resolveRuntimeRouteConnection,
  type TaskDocuments,
  toRuntimeConnection,
} from "../runtime/runtime";
import { createRepoStaleGuard, normalizeWorkingDirectory } from "../support/core";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import {
  defaultScenarioForRole,
  fromPersistedSessionRecord,
  historyToChatMessages,
  recoverPendingQuestionsFromHistory,
} from "../support/persistence";
import {
  buildSessionPreludeMessages,
  buildSessionSystemPrompt,
  loadSessionPromptContext,
} from "../support/session-prompt";
import { warmSessionData } from "../support/session-warmup";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionLifecycleAdapter = Pick<
  AgentEnginePort,
  "hasSession" | "listRuntimeSessions" | "loadSessionHistory" | "resumeSession"
>;

const INITIAL_SESSION_HISTORY_LIMIT = 600;
const SESSION_HISTORY_HYDRATION_CONCURRENCY = 3;

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
    pendingPermissions: persisted.pendingPermissions,
    pendingQuestions: persisted.pendingQuestions,
    selectedModel: mergeModelSelection(current.selectedModel, persisted.selectedModel ?? undefined),
    promptOverrides,
  };
};

const readPersistedRuntimeKind = ({
  sessionId,
  runtimeKind,
  selectedModel,
}: Pick<AgentSessionRecord, "sessionId" | "runtimeKind" | "selectedModel">): RuntimeKind => {
  const resolvedRuntimeKind = runtimeKind ?? selectedModel?.runtimeKind;
  if (!resolvedRuntimeKind) {
    throw new Error(`Persisted session '${sessionId}' is missing runtime kind metadata.`);
  }
  return resolvedRuntimeKind;
};

const toLiveSessionState = (
  status: Awaited<ReturnType<SessionLifecycleAdapter["listRuntimeSessions"]>>[number]["status"],
): AgentSessionState["status"] => {
  if (status.type === "busy" || status.type === "retry") {
    return "running";
  }
  return "idle";
};

type ResolvedRuntime =
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

type CreateLoadAgentSessionsArgs = {
  activeRepo: string | null;
  adapter: SessionLifecycleAdapter;
  repoEpochRef: MutableRefObject<number>;
  previousRepoRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  taskRef: MutableRefObject<TaskCard[]>;
  updateSession: UpdateSession;
  attachSessionListener?: (repoPath: string, sessionId: string) => void;
  loadSessionTodos: (
    sessionId: string,
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<void>;
  loadSessionModelCatalog: (
    sessionId: string,
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<void>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
  loadTaskDocuments?: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
};

export const createLoadAgentSessions = ({
  activeRepo,
  adapter,
  repoEpochRef,
  previousRepoRef,
  sessionsRef,
  setSessionsById,
  taskRef,
  updateSession,
  attachSessionListener,
  loadSessionTodos,
  loadSessionModelCatalog,
  loadRepoPromptOverrides,
  loadTaskDocuments,
}: CreateLoadAgentSessionsArgs): ((
  taskId: string,
  options?: AgentSessionLoadOptions,
) => Promise<void>) => {
  return async (taskId: string, options?: AgentSessionLoadOptions): Promise<void> => {
    if (!activeRepo || taskId.trim().length === 0) {
      return;
    }

    const repoPath = activeRepo;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      previousRepoRef,
    });
    if (isStaleRepoOperation()) {
      return;
    }

    const warmPersistedSession = (
      targetSessionId: string,
      runtimeKind: RuntimeKind,
      runtimeConnection: AgentRuntimeConnection,
      externalSessionId: string,
      role: AgentSessionState["role"],
      shouldLoadModelCatalog = true,
    ): void => {
      warmSessionData(
        {
          repoPath,
          sessionId: targetSessionId,
          taskId,
          role,
          runtimeKind,
          runtimeConnection,
          externalSessionId,
        },
        {
          loadSessionTodos,
          loadSessionModelCatalog,
        },
        {
          operationPrefix: "load-sessions-warm-session",
          shouldLoadModelCatalog,
        },
      );
    };

    const [persisted, repoPromptOverrides] = await Promise.all([
      loadAgentSessionListFromQuery(appQueryClient, repoPath, taskId, { forceFresh: true }),
      loadRepoPromptOverrides(repoPath),
    ]);
    if (isStaleRepoOperation()) {
      return;
    }

    const requestedSessionId = options?.hydrateHistoryForSessionId?.trim() || null;
    const shouldHydrateRequestedSession = requestedSessionId !== null;
    const shouldReconcileLiveSessions = options?.reconcileLiveSessions === true;

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
            repoPromptOverrides,
          );
          continue;
        }
        next[record.sessionId] = {
          ...fromPersistedSessionRecord(record, taskId),
          promptOverrides: repoPromptOverrides,
        };
      }
      return next;
    });

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
          if (!shouldHydrateRequestedSession) {
            return false;
          }
          const existingSession = sessionsRef.current[record.sessionId];
          return !existingSession || existingSession.messages.length === 0;
        })
        .map((record) => record.sessionId),
    );

    if (recordsToHydrate.length === 0) {
      const requestedSession = requestedSessionId
        ? sessionsRef.current[requestedSessionId]
        : undefined;
      if (
        requestedSession &&
        requestedSession.taskId === taskId &&
        requestedSession.runtimeEndpoint &&
        requestedSession.workingDirectory
      ) {
        const requestedRecord = requestedSessionId
          ? persisted.find((record) => record.sessionId === requestedSessionId)
          : undefined;
        const runtimeConnection = toRuntimeConnection(
          requestedSession.runtimeEndpoint,
          requestedSession.workingDirectory,
        );
        const requestedRuntimeKind =
          requestedRecord?.runtimeKind ??
          requestedRecord?.selectedModel?.runtimeKind ??
          requestedSession.runtimeKind ??
          requestedSession.selectedModel?.runtimeKind;
        if (!requestedRuntimeKind) {
          throw new Error(`Session '${requestedSession.sessionId}' is missing runtime kind.`);
        }
        warmPersistedSession(
          requestedSession.sessionId,
          requestedRuntimeKind,
          runtimeConnection,
          requestedSession.externalSessionId,
          requestedSession.role,
          !requestedSession.modelCatalog && !requestedSession.isLoadingModelCatalog,
        );
      }
      return;
    }

    const runtimeKindsToInspect = Array.from(
      new Set(recordsToHydrate.map((record) => readPersistedRuntimeKind(record))),
    );
    const runtimeLists = await Promise.all(
      runtimeKindsToInspect.map(async (runtimeKind) => {
        const runtimes = await loadRuntimeListFromQuery(appQueryClient, runtimeKind, repoPath);
        return [runtimeKind, runtimes] as const;
      }),
    );
    const runtimesByKind = new Map(runtimeLists);

    const requiresRunInspection = recordsToHydrate.some(
      (record) => record.role === "build" || record.role === "qa",
    );
    const liveRuns = requiresRunInspection
      ? await loadRepoRunsFromQuery(appQueryClient, repoPath)
      : [];
    const ensuredWorkspaceRuntimes = new Map<RuntimeKind, RuntimeInstanceSummary | null>();

    const ensureWorkspaceRuntime = async (
      runtimeKind: RuntimeKind,
    ): Promise<RuntimeInstanceSummary | null> => {
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

    const findRuntimeByWorkingDirectory = (
      runtimeKind: RuntimeKind,
      workingDirectory: string,
    ): RuntimeInstanceSummary | null => {
      const runtimes = runtimesByKind.get(runtimeKind) ?? [];
      const normalizedDirectory = normalizeWorkingDirectory(workingDirectory);
      return (
        runtimes.find(
          (runtime) => normalizeWorkingDirectory(runtime.workingDirectory) === normalizedDirectory,
        ) ?? null
      );
    };

    const findRunByWorkingDirectory = (
      runtimeKind: RuntimeKind,
      workingDirectory: string,
    ): RunSummary | null => {
      const normalizedDirectory = normalizeWorkingDirectory(workingDirectory);
      return (
        liveRuns.find(
          (run) =>
            run.runtimeKind === runtimeKind &&
            normalizeWorkingDirectory(run.worktreePath) === normalizedDirectory,
        ) ?? null
      );
    };

    const resolveHydrationRuntime = async (
      record: AgentSessionRecord,
    ): Promise<ResolvedRuntime> => {
      const runtimeKind = readPersistedRuntimeKind(record);
      const workingDirectory = record.workingDirectory;

      if (record.role === "build" || record.role === "qa") {
        const run = findRunByWorkingDirectory(runtimeKind, workingDirectory);
        if (run) {
          const { runtimeEndpoint, runtimeConnection } = resolveRuntimeRouteConnection(
            run.runtimeRoute,
            workingDirectory,
          );
          return {
            ok: true,
            runtimeKind,
            runtimeId: null,
            runId: run.runId,
            runtimeEndpoint,
            runtimeConnection,
          };
        }
      }

      const runtime = findRuntimeByWorkingDirectory(runtimeKind, workingDirectory);
      if (runtime) {
        const { runtimeEndpoint, runtimeConnection } = resolveRuntimeRouteConnection(
          runtime.runtimeRoute,
          workingDirectory,
        );
        return {
          ok: true,
          runtimeKind,
          runtimeId: runtime.runtimeId,
          runId: null,
          runtimeEndpoint,
          runtimeConnection,
        };
      }

      const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
      const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
      const shouldEnsureWorkspaceRuntime =
        record.role === "build" ||
        (record.role === "qa" && normalizedWorkingDirectory !== normalizedRepoPath) ||
        ((record.role === "spec" || record.role === "planner") &&
          normalizedWorkingDirectory === normalizedRepoPath);

      if (!shouldEnsureWorkspaceRuntime) {
        return {
          ok: false,
          runtimeKind,
          reason: `No live runtime found for working directory ${workingDirectory}.`,
        };
      }

      const workspaceRuntime = await ensureWorkspaceRuntime(runtimeKind);
      if (!workspaceRuntime) {
        return {
          ok: false,
          runtimeKind,
          reason: `Runtime ${runtimeKind} is unavailable for session hydration.`,
        };
      }
      const { runtimeEndpoint, runtimeConnection } = resolveRuntimeRouteConnection(
        workspaceRuntime.runtimeRoute,
        workingDirectory,
      );
      return {
        ok: true,
        runtimeKind,
        runtimeId: workspaceRuntime.runtimeId,
        runId: null,
        runtimeEndpoint,
        runtimeConnection,
      };
    };

    const buildHydrationPreludeMessages = ({
      record,
      resolvedScenario,
    }: {
      record: AgentSessionRecord;
      resolvedScenario: AgentSessionState["scenario"];
    }): AgentSessionState["messages"] => {
      const task = taskRef.current.find((entry) => entry.id === taskId);
      if (!task) {
        return buildSessionPreludeMessages({
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
        promptOverrides: repoPromptOverrides,
        documents: {
          specMarkdown: "",
          planMarkdown: "",
          qaMarkdown: "",
        },
      });

      return buildSessionPreludeMessages({
        sessionId: record.sessionId,
        role: record.role,
        scenario: resolvedScenario,
        systemPrompt,
        startedAt: record.startedAt,
      });
    };

    const runtimeSessionsByKey = new Map<
      string,
      Awaited<ReturnType<SessionLifecycleAdapter["listRuntimeSessions"]>>
    >();
    const listLiveRuntimeSessions = async (
      runtimeKind: RuntimeKind,
      runtimeConnection: AgentRuntimeConnection,
    ) => {
      const key = `${runtimeKind}::${runtimeConnection.endpoint}::${runtimeConnection.workingDirectory}`;
      if (runtimeSessionsByKey.has(key)) {
        return runtimeSessionsByKey.get(key) ?? [];
      }
      const sessions = await adapter.listRuntimeSessions({
        runtimeKind,
        runtimeConnection,
      });
      runtimeSessionsByKey.set(key, sessions);
      return sessions;
    };

    const maybeResumeLiveRecord = async (record: AgentSessionRecord): Promise<void> => {
      if (typeof adapter.hasSession !== "function" || !attachSessionListener) {
        return;
      }

      const runtimeResolution = await resolveHydrationRuntime(record);
      if (!runtimeResolution.ok) {
        return;
      }

      const externalSessionId = record.externalSessionId ?? record.sessionId;
      const attachedExistingSession = adapter.hasSession(record.sessionId);
      const runtimeSessions = await listLiveRuntimeSessions(
        runtimeResolution.runtimeKind,
        runtimeResolution.runtimeConnection,
      );
      const liveSession = runtimeSessions.find(
        (session) => session.externalSessionId === externalSessionId,
      );
      if (!liveSession) {
        return;
      }
      const nextStatus = toLiveSessionState(liveSession.status);

      const selectedModel = normalizePersistedSelection(record.selectedModel);
      if (!attachedExistingSession) {
        if (typeof adapter.resumeSession !== "function" || !loadTaskDocuments) {
          return;
        }

        const task = taskRef.current.find((entry) => entry.id === taskId);
        if (!task) {
          throw new Error(`Task not found: ${taskId}`);
        }

        const resolvedScenario = record.scenario ?? defaultScenarioForRole(record.role);
        const promptContext = await loadSessionPromptContext({
          repoPath,
          taskId,
          role: record.role,
          scenario: resolvedScenario,
          task,
          loadTaskDocuments,
          loadRepoPromptOverrides,
        });
        if (isStaleRepoOperation()) {
          return;
        }

        await adapter.resumeSession({
          sessionId: record.sessionId,
          externalSessionId,
          repoPath,
          runtimeKind: runtimeResolution.runtimeKind,
          runtimeConnection: runtimeResolution.runtimeConnection,
          workingDirectory: runtimeResolution.runtimeConnection.workingDirectory,
          taskId,
          role: record.role,
          scenario: resolvedScenario,
          systemPrompt: promptContext.systemPrompt,
          ...(selectedModel ? { model: selectedModel } : {}),
        });
      }

      attachSessionListener(repoPath, record.sessionId);
      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          runtimeKind: runtimeResolution.runtimeKind,
          runtimeId: runtimeResolution.runtimeId,
          runId: runtimeResolution.runId,
          runtimeEndpoint: runtimeResolution.runtimeEndpoint,
          workingDirectory: runtimeResolution.runtimeConnection.workingDirectory,
          status: nextStatus,
          promptOverrides: repoPromptOverrides,
          selectedModel: mergeModelSelection(current.selectedModel, selectedModel ?? undefined),
        }),
        { persist: false },
      );
      warmPersistedSession(
        record.sessionId,
        runtimeResolution.runtimeKind,
        runtimeResolution.runtimeConnection,
        externalSessionId,
        record.role,
        true,
      );
    };

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
        await Promise.all(batch.map((record) => maybeResumeLiveRecord(record)));
      }
    }

    const hydrateRecord = async (record: AgentSessionRecord): Promise<void> => {
      if (isStaleRepoOperation()) {
        return;
      }

      const shouldHydrateHistory = historyHydrationSessionIds.has(record.sessionId);
      const workingDirectory = record.workingDirectory;
      const runtimeResolution = await resolveHydrationRuntime(record);
      if (!runtimeResolution.ok) {
        if (shouldHydrateHistory) {
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
            promptOverrides: repoPromptOverrides,
          }),
          { persist: false },
        );
        return;
      }

      const externalSessionId = record.externalSessionId ?? record.sessionId;
      const resolvedScenario = record.scenario ?? defaultScenarioForRole(record.role);
      if (!shouldHydrateHistory) {
        updateSession(
          record.sessionId,
          (current) => ({
            ...current,
            runtimeKind: runtimeResolution.runtimeKind,
            runtimeId: runtimeResolution.runtimeId,
            runId: runtimeResolution.runId,
            runtimeEndpoint: runtimeResolution.runtimeEndpoint,
            workingDirectory,
            promptOverrides: repoPromptOverrides,
          }),
          { persist: false },
        );

        if (requestedSessionId && record.sessionId === requestedSessionId) {
          const requestedSession = sessionsRef.current[record.sessionId];
          warmPersistedSession(
            record.sessionId,
            runtimeResolution.runtimeKind,
            runtimeResolution.runtimeConnection,
            externalSessionId,
            record.role,
            !requestedSession?.modelCatalog && !requestedSession?.isLoadingModelCatalog,
          );
        }
        return;
      }

      const preludeMessages = buildHydrationPreludeMessages({
        record,
        resolvedScenario,
      });
      const history = await adapter.loadSessionHistory({
        runtimeKind: runtimeResolution.runtimeKind,
        runtimeConnection: runtimeResolution.runtimeConnection,
        externalSessionId,
        limit: INITIAL_SESSION_HISTORY_LIMIT,
      });
      const recoveredPendingQuestions =
        (record.pendingQuestions?.length ?? 0) > 0 ? record.pendingQuestions : undefined;
      if (isStaleRepoOperation()) {
        return;
      }

      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          runtimeKind: runtimeResolution.runtimeKind,
          runtimeId: runtimeResolution.runtimeId,
          runId: runtimeResolution.runId,
          runtimeEndpoint: runtimeResolution.runtimeEndpoint,
          workingDirectory,
          promptOverrides: repoPromptOverrides,
          pendingQuestions:
            recoveredPendingQuestions && recoveredPendingQuestions.length > 0
              ? current.pendingQuestions
              : recoverPendingQuestionsFromHistory(history),
          messages: [
            ...preludeMessages,
            ...historyToChatMessages(history, {
              role: record.role,
              selectedModel: normalizePersistedSelection(record.selectedModel),
            }),
          ],
        }),
        { persist: false },
      );
      warmPersistedSession(
        record.sessionId,
        runtimeResolution.runtimeKind,
        runtimeResolution.runtimeConnection,
        externalSessionId,
        record.role,
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
      await Promise.all(batch.map((record) => hydrateRecord(record)));
    }
  };
};
