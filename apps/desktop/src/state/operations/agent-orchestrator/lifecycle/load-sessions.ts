import type {
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
import { resolveRuntimeRouteConnection, toRuntimeConnection } from "../runtime/runtime";
import { createRepoStaleGuard, normalizeWorkingDirectory } from "../support/core";
import { mergeModelSelection, normalizePersistedSelection } from "../support/models";
import {
  defaultScenarioForRole,
  fromPersistedSessionRecord,
  historyToChatMessages,
  recoverPendingQuestionsFromHistory,
} from "../support/persistence";
import { buildSessionPreludeMessages, buildSessionSystemPrompt } from "../support/session-prompt";
import { warmSessionData } from "../support/session-warmup";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionHistoryAdapter = Pick<AgentEnginePort, "loadSessionHistory">;

const INITIAL_SESSION_HISTORY_LIMIT = 600;
const SESSION_HISTORY_HYDRATION_CONCURRENCY = 3;
type PersistedSessionRecord = Awaited<ReturnType<typeof loadAgentSessionListFromQuery>>[number];

const mergePersistedSessionRecord = (
  current: AgentSessionState,
  record: PersistedSessionRecord,
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
}: Pick<PersistedSessionRecord, "sessionId" | "runtimeKind" | "selectedModel">): RuntimeKind => {
  const resolvedRuntimeKind = runtimeKind ?? selectedModel?.runtimeKind;
  if (!resolvedRuntimeKind) {
    throw new Error(`Persisted session '${sessionId}' is missing runtime kind metadata.`);
  }
  return resolvedRuntimeKind;
};

type CreateLoadAgentSessionsArgs = {
  activeRepo: string | null;
  adapter: SessionHistoryAdapter;
  repoEpochRef: MutableRefObject<number>;
  previousRepoRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  taskRef: MutableRefObject<TaskCard[]>;
  updateSession: UpdateSession;
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
  loadSessionTodos,
  loadSessionModelCatalog,
  loadRepoPromptOverrides,
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
      loadAgentSessionListFromQuery(appQueryClient, repoPath, taskId),
      loadRepoPromptOverrides(repoPath),
    ]);
    if (isStaleRepoOperation()) {
      return;
    }

    const requestedSessionId = options?.hydrateHistoryForSessionId?.trim() || null;
    const shouldHydrateRequestedSession = requestedSessionId !== null;
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

    const historyHydrationSessionIds = new Set(
      persisted
        .filter((record) => {
          if (shouldHydrateRequestedSession && record.sessionId !== requestedSessionId) {
            return false;
          }
          if (!shouldHydrateRequestedSession) {
            return false;
          }
          const existingSession = sessionsRef.current[record.sessionId];
          return !existingSession || existingSession.messages.length === 0;
        })
        .map((record) => record.sessionId),
    );
    if (!shouldHydrateRequestedSession) {
      return;
    }

    const recordsToHydrate = persisted.filter((record) => record.sessionId === requestedSessionId);

    if (recordsToHydrate.length === 0) {
      if (!shouldHydrateRequestedSession) {
        return;
      }

      const requestedSession = requestedSessionId
        ? sessionsRef.current[requestedSessionId]
        : undefined;
      if (
        requestedSession &&
        requestedSession.taskId === taskId &&
        requestedSession.runtimeEndpoint &&
        requestedSession.workingDirectory
      ) {
        const requestedRecord =
          requestedSessionId === null
            ? undefined
            : persisted.find((record) => record.sessionId === requestedSessionId);
        const runtimeConnection = toRuntimeConnection(
          requestedSession.runtimeEndpoint,
          requestedSession.workingDirectory,
        );
        const requestedRuntimeKind = requestedRecord
          ? readPersistedRuntimeKind(requestedRecord)
          : (requestedSession.runtimeKind ?? requestedSession.selectedModel?.runtimeKind);
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

    const runtimeKindsToHydrate = Array.from(
      new Set(recordsToHydrate.map((record) => readPersistedRuntimeKind(record))),
    );
    const runtimeLists = await Promise.all(
      runtimeKindsToHydrate.map(async (runtimeKind) => {
        const runtimes = await loadRuntimeListFromQuery(appQueryClient, runtimeKind, repoPath);
        return [runtimeKind, runtimes] as const;
      }),
    );
    const runtimesByKind = new Map(runtimeLists);

    const liveRuns = recordsToHydrate.some(
      (record) => record.role === "build" || record.role === "qa",
    )
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
      if (runtime) {
        await appQueryClient.invalidateQueries({
          queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
          exact: true,
          refetchType: "none",
        });
      }
      return runtime;
    };

    const findRuntimeByWorkingDirectory = (
      runtimeKind: RuntimeKind,
      workingDirectory: string,
    ): RuntimeInstanceSummary | null => {
      const runtimes = runtimesByKind.get(runtimeKind) ?? [];
      const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
      return (
        runtimes.find(
          (runtime) =>
            normalizeWorkingDirectory(runtime.workingDirectory) === normalizedWorkingDirectory,
        ) ?? null
      );
    };

    const findRunByWorkingDirectory = (
      runtimeKind: RuntimeKind,
      workingDirectory: string,
    ): RunSummary | null => {
      const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
      return (
        liveRuns.find(
          (run) =>
            run.runtimeKind === runtimeKind &&
            normalizeWorkingDirectory(run.worktreePath) === normalizedWorkingDirectory,
        ) ?? null
      );
    };

    const resolveHydrationRuntime = async (
      record: PersistedSessionRecord,
    ): Promise<
      | {
          ok: true;
          runtimeKind: RuntimeKind;
          runtimeEndpoint: string;
          runtimeConnection: AgentRuntimeConnection;
        }
      | {
          ok: false;
          runtimeKind: RuntimeKind;
          reason: string;
        }
    > => {
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
          runtimeEndpoint,
          runtimeConnection,
        };
      }

      const shouldEnsureWorkspaceRuntime =
        record.role === "build" ||
        (record.role === "qa" &&
          normalizeWorkingDirectory(workingDirectory) !== normalizeWorkingDirectory(repoPath)) ||
        ((record.role === "spec" || record.role === "planner") && workingDirectory === repoPath);
      if (shouldEnsureWorkspaceRuntime) {
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
          runtimeEndpoint,
          runtimeConnection,
        };
      }

      return {
        ok: false,
        runtimeKind,
        reason: `No live runtime found for working directory ${workingDirectory}.`,
      };
    };

    const buildHydrationPreludeMessages = ({
      record,
      resolvedScenario,
    }: {
      record: PersistedSessionRecord;
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
    if (isStaleRepoOperation()) {
      return;
    }

    const hydrateRecord = async (record: PersistedSessionRecord): Promise<void> => {
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
            runtimeEndpoint: "",
            workingDirectory,
            promptOverrides: repoPromptOverrides,
          }),
          { persist: false },
        );
        return;
      }
      const { runtimeKind, runtimeConnection, runtimeEndpoint } = runtimeResolution;
      const externalSessionId = record.externalSessionId ?? record.sessionId;
      const resolvedScenario = record.scenario ?? defaultScenarioForRole(record.role);
      if (!shouldHydrateHistory) {
        if (isStaleRepoOperation()) {
          return;
        }
        updateSession(
          record.sessionId,
          (current) => ({
            ...current,
            runtimeKind,
            runtimeEndpoint,
            workingDirectory,
            promptOverrides: repoPromptOverrides,
          }),
          { persist: false },
        );
        if (shouldHydrateRequestedSession && record.sessionId === requestedSessionId) {
          const requestedSession = sessionsRef.current[record.sessionId];
          warmPersistedSession(
            record.sessionId,
            runtimeKind,
            runtimeConnection,
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

      if (isStaleRepoOperation()) {
        return;
      }

      const history = await adapter.loadSessionHistory({
        runtimeKind,
        runtimeConnection,
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
          runtimeKind,
          runtimeEndpoint,
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
        runtimeKind,
        runtimeConnection,
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
