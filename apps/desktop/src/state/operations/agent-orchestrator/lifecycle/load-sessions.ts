import type {
  RepoPromptOverrides,
  RunSummary,
  RuntimeInstanceSummary,
  RuntimeKind,
  RuntimeRoute,
  TaskCard,
} from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type AgentRuntimeConnection,
  buildAgentSystemPrompt,
} from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../host";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../support/async-side-effects";
import {
  createRepoStaleGuard,
  defaultScenarioForRole,
  fromPersistedSessionRecord,
  historyToChatMessages,
  normalizePersistedSelection,
  now,
  upsertMessage,
} from "../support/utils";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionHistoryAdapter = Pick<AgentEnginePort, "loadSessionHistory">;
type SessionHistoryLoadResult =
  | {
      ok: true;
      history: Awaited<ReturnType<SessionHistoryAdapter["loadSessionHistory"]>>;
    }
  | {
      ok: false;
      reason: string;
    };

const INITIAL_SESSION_HISTORY_LIMIT = 600;
const SESSION_HISTORY_HYDRATION_CONCURRENCY = 3;

const resolveRuntimeRouteEndpoint = (runtimeRoute: RuntimeRoute): string => {
  switch (runtimeRoute.type) {
    case "local_http":
      return runtimeRoute.endpoint;
  }
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

    const warmSessionData = (
      targetSessionId: string,
      runtimeKind: RuntimeKind,
      runtimeConnection: AgentRuntimeConnection,
      externalSessionId: string,
    ): void => {
      runOrchestratorSideEffect(
        "load-sessions-warm-session-todos",
        loadSessionTodos(targetSessionId, runtimeKind, runtimeConnection, externalSessionId),
        {
          tags: {
            repoPath,
            sessionId: targetSessionId,
            externalSessionId,
          },
        },
      );
      runOrchestratorSideEffect(
        "load-sessions-warm-session-model-catalog",
        loadSessionModelCatalog(targetSessionId, runtimeKind, runtimeConnection),
        {
          tags: {
            repoPath,
            sessionId: targetSessionId,
          },
        },
      );
    };

    const [persisted, repoPromptOverrides] = await Promise.all([
      host.agentSessionsList(repoPath, taskId),
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
        if (next[record.sessionId]) {
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

    const recordsToHydrate = persisted.filter((record) => {
      if (shouldHydrateRequestedSession && record.sessionId !== requestedSessionId) {
        return false;
      }
      if (!shouldHydrateRequestedSession) {
        return false;
      }
      const existingSession = sessionsRef.current[record.sessionId];
      return !existingSession || existingSession.messages.length === 0;
    });

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
        !requestedSession.modelCatalog &&
        !requestedSession.isLoadingModelCatalog &&
        requestedSession.runtimeEndpoint &&
        requestedSession.workingDirectory
      ) {
        const runtimeConnection = {
          endpoint: requestedSession.runtimeEndpoint,
          workingDirectory: requestedSession.workingDirectory,
        } satisfies AgentRuntimeConnection;
        const requestedRuntimeKind =
          requestedSession.runtimeKind ??
          requestedSession.selectedModel?.runtimeKind ??
          DEFAULT_RUNTIME_KIND;
        warmSessionData(
          requestedSession.sessionId,
          requestedRuntimeKind,
          runtimeConnection,
          requestedSession.externalSessionId,
        );
      }
      return;
    }

    const runtimeKindsToHydrate = Array.from(
      new Set(
        recordsToHydrate.map(
          (record) =>
            record.runtimeKind ?? record.selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
        ),
      ),
    );
    const runtimeLists = await Promise.all(
      runtimeKindsToHydrate.map(async (runtimeKind) => {
        const runtimes = await captureOrchestratorFallback(
          "load-sessions-list-runtimes",
          async () => host.runtimeList(runtimeKind, repoPath),
          {
            tags: { repoPath, taskId, runtimeKind },
            logLevel: "warn",
            fallback: () => [] as RuntimeInstanceSummary[],
          },
        );
        return [runtimeKind, runtimes] as const;
      }),
    );
    const runtimesByKind = new Map(runtimeLists);

    const liveRuns = recordsToHydrate.some((record) => record.role === "build")
      ? await captureOrchestratorFallback(
          "load-sessions-list-runs",
          async () => host.runsList(repoPath),
          {
            tags: { repoPath, taskId },
            logLevel: "warn",
            fallback: () => [] as RunSummary[],
          },
        )
      : [];
    const ensuredWorkspaceRuntimes = new Map<RuntimeKind, RuntimeInstanceSummary | null>();

    const ensureWorkspaceRuntime = async (
      runtimeKind: RuntimeKind,
    ): Promise<RuntimeInstanceSummary | null> => {
      if (ensuredWorkspaceRuntimes.has(runtimeKind)) {
        return ensuredWorkspaceRuntimes.get(runtimeKind) ?? null;
      }
      const runtime = await captureOrchestratorFallback(
        "load-sessions-ensure-workspace-runtime",
        async () => host.runtimeEnsure(runtimeKind, repoPath),
        {
          tags: { repoPath, taskId, runtimeKind },
          logLevel: "warn",
          fallback: () => null,
        },
      );
      ensuredWorkspaceRuntimes.set(runtimeKind, runtime);
      return runtime;
    };

    const findRuntimeByWorkingDirectory = (
      runtimeKind: RuntimeKind,
      workingDirectory: string,
    ): RuntimeInstanceSummary | null => {
      const runtimes = runtimesByKind.get(runtimeKind) ?? [];
      return runtimes.find((runtime) => runtime.workingDirectory === workingDirectory) ?? null;
    };

    const findRunByWorkingDirectory = (
      runtimeKind: RuntimeKind,
      workingDirectory: string,
    ): RunSummary | null => {
      return (
        liveRuns.find(
          (run) => run.runtimeKind === runtimeKind && run.worktreePath === workingDirectory,
        ) ?? null
      );
    };

    const resolveLiveRuntimeEndpoint = async (
      record: (typeof recordsToHydrate)[number],
    ): Promise<{ ok: true; endpoint: string } | { ok: false; reason: string }> => {
      const runtimeKind =
        record.runtimeKind ?? record.selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND;
      const workingDirectory = record.workingDirectory;
      if (record.role === "build") {
        const run = findRunByWorkingDirectory(runtimeKind, workingDirectory);
        if (run) {
          return {
            ok: true,
            endpoint: resolveRuntimeRouteEndpoint(run.runtimeRoute),
          };
        }
      }

      const runtime = findRuntimeByWorkingDirectory(runtimeKind, workingDirectory);
      if (runtime) {
        return {
          ok: true,
          endpoint: resolveRuntimeRouteEndpoint(runtime.runtimeRoute),
        };
      }

      const shouldEnsureWorkspaceRuntime =
        record.role === "build" ||
        ((record.role === "spec" || record.role === "planner") && workingDirectory === repoPath);
      if (shouldEnsureWorkspaceRuntime) {
        const workspaceRuntime = await ensureWorkspaceRuntime(runtimeKind);
        if (!workspaceRuntime) {
          return {
            ok: false,
            reason: `Runtime ${runtimeKind} is unavailable for session hydration.`,
          };
        }
        return {
          ok: true,
          endpoint: resolveRuntimeRouteEndpoint(workspaceRuntime.runtimeRoute),
        };
      }

      return {
        ok: false,
        reason: `No live runtime found for working directory ${workingDirectory}.`,
      };
    };
    if (isStaleRepoOperation()) {
      return;
    }

    const hydrateRecord = async (record: (typeof recordsToHydrate)[number]): Promise<void> => {
      if (isStaleRepoOperation()) {
        return;
      }

      const existingSession = sessionsRef.current[record.sessionId];
      const workingDirectory = record.workingDirectory;
      const recordRuntimeKind =
        record.runtimeKind ?? record.selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND;
      const runtimeResolution = await resolveLiveRuntimeEndpoint(record);
      if (!runtimeResolution.ok) {
        updateSession(
          record.sessionId,
          (current) => ({
            ...current,
            runtimeKind: recordRuntimeKind,
            runtimeEndpoint: "",
            workingDirectory,
            promptOverrides: repoPromptOverrides,
            messages:
              existingSession && existingSession.messages.length > 0
                ? current.messages
                : upsertMessage(current.messages, {
                    id: `history-unavailable:${record.sessionId}`,
                    role: "system",
                    content: `Session runtime unavailable: ${runtimeResolution.reason}`,
                    timestamp: now(),
                  }),
          }),
          { persist: false },
        );
        return;
      }
      const runtimeEndpoint = runtimeResolution.endpoint;
      const runtimeConnection = {
        endpoint: runtimeEndpoint,
        workingDirectory,
      } satisfies AgentRuntimeConnection;
      const externalSessionId = record.externalSessionId ?? record.sessionId;
      const resolvedScenario = record.scenario ?? defaultScenarioForRole(record.role);
      if (existingSession && existingSession.messages.length > 0) {
        if (isStaleRepoOperation()) {
          return;
        }
        updateSession(
          record.sessionId,
          (current) => ({
            ...current,
            runtimeKind: recordRuntimeKind,
            runtimeEndpoint,
            workingDirectory,
            promptOverrides: repoPromptOverrides,
          }),
          { persist: false },
        );
        warmSessionData(record.sessionId, recordRuntimeKind, runtimeConnection, externalSessionId);
        return;
      }

      const historyPromise = captureOrchestratorFallback<SessionHistoryLoadResult>(
        "load-sessions-load-history",
        async () => {
          const history = await adapter.loadSessionHistory({
            runtimeKind: recordRuntimeKind,
            runtimeConnection,
            externalSessionId,
            limit: INITIAL_SESSION_HISTORY_LIMIT,
          });
          return { ok: true as const, history };
        },
        {
          tags: {
            repoPath,
            taskId,
            sessionId: record.sessionId,
            externalSessionId,
          },
          logLevel: "warn",
          fallback: (failure): SessionHistoryLoadResult => ({
            ok: false,
            reason: failure.reason,
          }),
        },
      );

      // Build basic prelude - documents loaded lazily when session is selected
      const basicPreludeMessages: AgentSessionState["messages"] = [
        {
          id: `history:session-start:${record.sessionId}`,
          role: "system",
          content: `Session started (${record.role} - ${resolvedScenario})`,
          timestamp: record.startedAt,
        },
      ];

      const task = taskRef.current.find((entry) => entry.id === taskId);
      const preludeMessages = task
        ? [
            ...basicPreludeMessages,
            {
              id: `history:system-prompt:${record.sessionId}`,
              role: "system" as const,
              content: `System prompt:\n\n${buildAgentSystemPrompt({
                role: record.role,
                scenario: resolvedScenario,
                task: {
                  taskId: task.id,
                  title: task.title,
                  issueType: task.issueType,
                  status: task.status,
                  qaRequired: task.aiReviewEnabled,
                  description: task.description,
                  acceptanceCriteria: task.acceptanceCriteria,
                  specMarkdown: "",
                  planMarkdown: "",
                  latestQaReportMarkdown: "",
                },
                overrides: repoPromptOverrides,
              })}`,
              timestamp: record.startedAt,
            },
          ]
        : basicPreludeMessages;

      if (isStaleRepoOperation()) {
        return;
      }

      const historyResult = await historyPromise;
      if (isStaleRepoOperation()) {
        return;
      }

      if (!historyResult.ok) {
        updateSession(
          record.sessionId,
          (current) => ({
            ...current,
            runtimeKind: recordRuntimeKind,
            runtimeEndpoint,
            workingDirectory,
            promptOverrides: repoPromptOverrides,
            messages: upsertMessage(current.messages, {
              id: `history-unavailable:${record.sessionId}`,
              role: "system",
              content: `Session history unavailable: ${historyResult.reason}`,
              timestamp: now(),
            }),
          }),
          { persist: false },
        );
        warmSessionData(record.sessionId, recordRuntimeKind, runtimeConnection, externalSessionId);
        return;
      }

      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          runtimeKind: recordRuntimeKind,
          runtimeEndpoint,
          workingDirectory,
          promptOverrides: repoPromptOverrides,
          messages: [
            ...preludeMessages,
            ...historyToChatMessages(historyResult.history, {
              role: record.role,
              selectedModel: normalizePersistedSelection(record.selectedModel),
            }),
          ],
        }),
        { persist: false },
      );
      warmSessionData(record.sessionId, recordRuntimeKind, runtimeConnection, externalSessionId);
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
