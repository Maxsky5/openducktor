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

// Module-level cache for task documents (spec, plan, QA) - persists across session loads
const taskDocumentsCache = new Map<
  string,
  {
    spec: Promise<string> | null;
    plan: Promise<string> | null;
    qa: Promise<string> | null;
  }
>();

const getCacheKey = (repoPath: string, taskId: string): string => `${repoPath}:${taskId}`;

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

    // Lazy-load task documents with caching - used when session is actually selected
    const loadTaskDocumentsWithCache = async (
      repoPath: string,
      taskId: string,
    ): Promise<[string, string, string]> => {
      const cacheKey = getCacheKey(repoPath, taskId);
      let cacheEntry = taskDocumentsCache.get(cacheKey);
      if (!cacheEntry) {
        cacheEntry = {
          spec: null,
          plan: null,
          qa: null,
        };
        taskDocumentsCache.set(cacheKey, cacheEntry);
      }

      const fetchPromises: Promise<void>[] = [];

      if (!cacheEntry.spec) {
        const specPromise = captureOrchestratorFallback(
          "load-sessions-load-prelude-document",
          async () => {
            const spec = await host.specGet(repoPath, taskId);
            return spec.markdown;
          },
          {
            tags: { repoPath, taskId, document: "spec" },
            logLevel: "warn",
            fallback: () => "",
          },
        );
        cacheEntry.spec = specPromise;
        fetchPromises.push(specPromise.then(() => {}));
      }

      if (!cacheEntry.plan) {
        const planPromise = captureOrchestratorFallback(
          "load-sessions-load-prelude-document",
          async () => {
            const plan = await host.planGet(repoPath, taskId);
            return plan.markdown;
          },
          {
            tags: { repoPath, taskId, document: "plan" },
            logLevel: "warn",
            fallback: () => "",
          },
        );
        cacheEntry.plan = planPromise;
        fetchPromises.push(planPromise.then(() => {}));
      }

      if (!cacheEntry.qa) {
        const qaPromise = captureOrchestratorFallback(
          "load-sessions-load-prelude-document",
          async () => {
            const qa = await host.qaGetReport(repoPath, taskId);
            return qa.markdown;
          },
          {
            tags: { repoPath, taskId, document: "qa" },
            logLevel: "warn",
            fallback: () => "",
          },
        );
        cacheEntry.qa = qaPromise;
        fetchPromises.push(qaPromise.then(() => {}));
      }

      await Promise.all(fetchPromises);

      const specResult = await cacheEntry.spec!;
      const planResult = await cacheEntry.plan!;
      const qaResult = await cacheEntry.qa!;

      return [specResult, planResult, qaResult];
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
              ...basicPreludeMessages,
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
