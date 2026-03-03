import type { TaskCard } from "@openducktor/contracts";
import { type AgentEnginePort, buildAgentSystemPrompt } from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
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
  toBaseUrl,
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
    baseUrl: string,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<void>;
  loadSessionModelCatalog: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
  ) => Promise<void>;
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
      baseUrl: string,
      workingDirectory: string,
      externalSessionId: string,
    ): void => {
      runOrchestratorSideEffect(
        "load-sessions-warm-session-todos",
        loadSessionTodos(targetSessionId, baseUrl, workingDirectory, externalSessionId),
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
        loadSessionModelCatalog(targetSessionId, baseUrl, workingDirectory),
        {
          tags: {
            repoPath,
            sessionId: targetSessionId,
          },
        },
      );
    };

    const persisted = await host.agentSessionsList(repoPath, taskId);
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
        next[record.sessionId] = fromPersistedSessionRecord(record, taskId);
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
        requestedSession.baseUrl &&
        requestedSession.workingDirectory
      ) {
        warmSessionData(
          requestedSession.sessionId,
          requestedSession.baseUrl,
          requestedSession.workingDirectory,
          requestedSession.externalSessionId,
        );
      }
      return;
    }

    const requiresWorkspaceRuntime = recordsToHydrate.length > 0;
    const workspaceRuntime = requiresWorkspaceRuntime
      ? await captureOrchestratorFallback(
          "load-sessions-ensure-workspace-runtime",
          async () => host.opencodeRepoRuntimeEnsure(repoPath),
          {
            tags: { repoPath, taskId },
            logLevel: "warn",
            fallback: () => null,
          },
        )
      : null;
    if (isStaleRepoOperation()) {
      return;
    }

    const hydrateRecord = async (record: (typeof recordsToHydrate)[number]): Promise<void> => {
      if (isStaleRepoOperation()) {
        return;
      }

      const baseUrl = workspaceRuntime ? toBaseUrl(workspaceRuntime.port) : (record.baseUrl ?? "");
      if (!workspaceRuntime && baseUrl.length === 0) {
        throw new Error(
          `Cannot hydrate session ${record.sessionId}: runtime baseUrl is missing from metadata.`,
        );
      }
      // Always use the persisted workingDirectory — it is the source of truth.
      // Build sessions store the worktree path; other roles store repoPath.
      const workingDirectory = record.workingDirectory;
      const externalSessionId = record.externalSessionId ?? record.sessionId;
      const resolvedScenario = record.scenario ?? defaultScenarioForRole(record.role);
      const existingSession = sessionsRef.current[record.sessionId];
      if (existingSession && existingSession.messages.length > 0) {
        if (isStaleRepoOperation()) {
          return;
        }
        updateSession(
          record.sessionId,
          (current) => ({
            ...current,
            baseUrl,
            workingDirectory,
          }),
          { persist: false },
        );
        warmSessionData(record.sessionId, baseUrl, workingDirectory, externalSessionId);
        return;
      }

      const historyPromise = captureOrchestratorFallback<SessionHistoryLoadResult>(
        "load-sessions-load-history",
        async () => {
          const history = await adapter.loadSessionHistory({
            baseUrl,
            workingDirectory,
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
            baseUrl,
            workingDirectory,
            messages: upsertMessage(current.messages, {
              id: `history-unavailable:${record.sessionId}`,
              role: "system",
              content: `Session history unavailable: ${historyResult.reason}`,
              timestamp: now(),
            }),
          }),
          { persist: false },
        );
        warmSessionData(record.sessionId, baseUrl, workingDirectory, externalSessionId);
        return;
      }

      updateSession(
        record.sessionId,
        (current) => ({
          ...current,
          baseUrl,
          workingDirectory,
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
      warmSessionData(record.sessionId, baseUrl, workingDirectory, externalSessionId);
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
