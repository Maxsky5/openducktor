import type { TaskCard } from "@openducktor/contracts";
import { type AgentEnginePort, buildAgentSystemPrompt } from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../host";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../support/async-side-effects";
import {
  createRepoStaleGuard,
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
}: CreateLoadAgentSessionsArgs): ((taskId: string) => Promise<void>) => {
  return async (taskId: string): Promise<void> => {
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
    const existingIds = new Set(Object.keys(sessionsRef.current));
    const recordsToHydrate = persisted.filter((record) => !existingIds.has(record.sessionId));
    setSessionsById((current) => {
      if (isStaleRepoOperation()) {
        return current;
      }
      const next = { ...current };
      for (const record of persisted) {
        if (next[record.sessionId]) {
          continue;
        }
        next[record.sessionId] = fromPersistedSessionRecord(record);
      }
      sessionsRef.current = next;
      return next;
    });

    if (isStaleRepoOperation()) {
      return;
    }

    if (recordsToHydrate.length === 0) {
      const existingSessions = Object.values(sessionsRef.current).filter(
        (entry) => entry.taskId === taskId && !entry.modelCatalog && !entry.isLoadingModelCatalog,
      );
      for (const session of existingSessions) {
        if (!session.baseUrl || !session.workingDirectory) {
          continue;
        }
        warmSessionData(
          session.sessionId,
          session.baseUrl,
          session.workingDirectory,
          session.externalSessionId,
        );
      }
      return;
    }

    const requiresWorkspaceRuntime = recordsToHydrate.some(
      (record) => record.role === "spec" || record.role === "planner",
    );
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

    await Promise.all(
      recordsToHydrate.map(async (record) => {
        if (isStaleRepoOperation()) {
          return;
        }
        const baseUrl =
          (record.role === "spec" || record.role === "planner") && workspaceRuntime
            ? toBaseUrl(workspaceRuntime.port)
            : record.baseUrl;
        const workingDirectory =
          (record.role === "spec" || record.role === "planner") && workspaceRuntime
            ? workspaceRuntime.workingDirectory
            : record.workingDirectory;
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
          warmSessionData(record.sessionId, baseUrl, workingDirectory, record.externalSessionId);
          return;
        }

        const historyPromise = captureOrchestratorFallback<SessionHistoryLoadResult>(
          "load-sessions-load-history",
          async () => {
            const history = await adapter.loadSessionHistory({
              baseUrl,
              workingDirectory,
              externalSessionId: record.externalSessionId,
              limit: 2000,
            });
            return { ok: true as const, history };
          },
          {
            tags: {
              repoPath,
              taskId: record.taskId,
              sessionId: record.sessionId,
              externalSessionId: record.externalSessionId,
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
            content: `Session started (${record.role} - ${record.scenario})`,
            timestamp: record.startedAt,
          },
        ];

        const task = taskRef.current.find((entry) => entry.id === record.taskId);
        const preludeMessages = task
          ? [
              ...basicPreludeMessages,
              {
                id: `history:system-prompt:${record.sessionId}`,
                role: "system" as const,
                content: `System prompt:\n\n${buildAgentSystemPrompt({
                  role: record.role,
                  scenario: record.scenario,
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
          warmSessionData(record.sessionId, baseUrl, workingDirectory, record.externalSessionId);
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
        warmSessionData(record.sessionId, baseUrl, workingDirectory, record.externalSessionId);
      }),
    );
  };
};
