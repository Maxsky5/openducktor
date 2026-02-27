import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openducktor/core";
import { buildAgentSystemPrompt } from "@openducktor/core";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../host";
import { requireActiveRepo } from "../../task-operations-model";
import type { RuntimeInfo, TaskDocuments } from "../runtime/runtime";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../support/async-side-effects";
import {
  createRepoStaleGuard,
  inferScenario,
  kickoffPrompt,
  throwIfRepoStale,
} from "../support/utils";

export type StartAgentSessionInput = {
  taskId: string;
  role: AgentRole;
  scenario?: AgentScenario;
  selectedModel?: AgentModelSelection | null;
  sendKickoff?: boolean;
  startMode?: "reuse_latest" | "fresh";
  requireModelReady?: boolean;
};

type StartSessionDependencies = {
  activeRepo: string | null;
  adapter: AgentEnginePort;
  setSessionsById: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
  sessionsRef: { current: Record<string, AgentSessionState> };
  taskRef: { current: TaskCard[] };
  repoEpochRef: { current: number };
  previousRepoRef: { current: string | null };
  inFlightStartsByRepoTaskRef: { current: Map<string, Promise<string>> };
  attachSessionListener: (repoPath: string, sessionId: string) => void;
  ensureRuntime: (repoPath: string, taskId: string, role: AgentRole) => Promise<RuntimeInfo>;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoDefaultModel: (repoPath: string, role: AgentRole) => Promise<AgentModelSelection | null>;
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
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  refreshTaskData: (repoPath: string) => Promise<void>;
  persistSessionSnapshot: (session: AgentSessionState) => Promise<void>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
};

const STALE_START_ERROR = "Workspace changed while starting session.";

const compareBySessionRecency = (
  a: { startedAt: string; sessionId: string },
  b: { startedAt: string; sessionId: string },
): number => {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt > b.startedAt ? -1 : 1;
  }
  if (a.sessionId === b.sessionId) {
    return 0;
  }
  return a.sessionId > b.sessionId ? -1 : 1;
};

const pickLatestSession = <T extends { startedAt: string; sessionId: string }>(
  sessions: T[],
): T | undefined => {
  return [...sessions].sort(compareBySessionRecency)[0];
};

export const createStartAgentSession = ({
  activeRepo,
  adapter,
  setSessionsById,
  sessionsRef,
  taskRef,
  repoEpochRef,
  previousRepoRef,
  inFlightStartsByRepoTaskRef,
  attachSessionListener,
  ensureRuntime,
  loadTaskDocuments,
  loadRepoDefaultModel,
  loadSessionTodos,
  loadSessionModelCatalog,
  loadAgentSessions,
  refreshTaskData,
  persistSessionSnapshot,
  sendAgentMessage,
}: StartSessionDependencies) => {
  return async ({
    taskId,
    role,
    scenario,
    selectedModel = null,
    sendKickoff = false,
    startMode = "reuse_latest",
    requireModelReady = false,
  }: StartAgentSessionInput): Promise<string> => {
    const repoPath = requireActiveRepo(activeRepo);
    const inFlightKey = `${repoPath}::${taskId}::${role}::${startMode}`;
    const existingInFlight = inFlightStartsByRepoTaskRef.current.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const startPromise = (async (): Promise<string> => {
      const isStaleRepoOperation = createRepoStaleGuard({
        repoPath,
        repoEpochRef,
        previousRepoRef,
      });
      throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);

      if (startMode === "reuse_latest") {
        const existingSession = pickLatestSession(
          Object.values(sessionsRef.current).filter(
            (entry) => entry.taskId === taskId && entry.role === role,
          ),
        );
        if (existingSession) {
          return existingSession.sessionId;
        }

        const persistedSessions = await host.agentSessionsList(repoPath, taskId);
        throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
        const latestPersistedSession = pickLatestSession(
          persistedSessions.filter((entry) => entry.role === role),
        );
        if (latestPersistedSession) {
          if (!sessionsRef.current[latestPersistedSession.sessionId]) {
            await loadAgentSessions(taskId, {
              hydrateHistoryForSessionId: latestPersistedSession.sessionId,
            });
            throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
          }
          return latestPersistedSession.sessionId;
        }
      }

      const task = taskRef.current.find((entry) => entry.id === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (!isRoleAvailableForTask(task, role)) {
        throw new Error(unavailableRoleErrorMessage(task, role));
      }

      const docsPromise = loadTaskDocuments(repoPath, taskId);
      const runtimePromise = ensureRuntime(repoPath, taskId, role);
      const defaultModelSelectionPromise = loadRepoDefaultModel(repoPath, role);

      const [docs, runtime] = await Promise.all([docsPromise, runtimePromise]);
      throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
      const resolvedScenario = scenario ?? inferScenario(role, task, docs);
      throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
      const systemPrompt = buildAgentSystemPrompt({
        role,
        scenario: resolvedScenario,
        task: {
          taskId: task.id,
          title: task.title,
          issueType: task.issueType,
          status: task.status,
          qaRequired: task.aiReviewEnabled,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          specMarkdown: docs.specMarkdown,
          planMarkdown: docs.planMarkdown,
          latestQaReportMarkdown: docs.qaMarkdown,
        },
      });

      const summary = await adapter.startSession({
        repoPath,
        workingDirectory: runtime.workingDirectory,
        taskId,
        role,
        scenario: resolvedScenario,
        systemPrompt,
        baseUrl: runtime.baseUrl,
      });
      if (isStaleRepoOperation()) {
        await captureOrchestratorFallback(
          "start-session-stop-on-stale-after-start",
          async () => adapter.stopSession(summary.sessionId),
          {
            tags: {
              repoPath,
              taskId,
              role,
              scenario: resolvedScenario,
              sessionId: summary.sessionId,
            },
            fallback: () => undefined,
          },
        );
        throw new Error(STALE_START_ERROR);
      }

      const initialSession: AgentSessionState = {
        sessionId: summary.sessionId,
        externalSessionId: summary.externalSessionId,
        taskId,
        role,
        scenario: resolvedScenario,
        status: "idle",
        startedAt: summary.startedAt,
        runtimeId: runtime.runtimeId,
        runId: runtime.runId,
        baseUrl: runtime.baseUrl,
        workingDirectory: runtime.workingDirectory,
        messages: [
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Session started (${role} - ${resolvedScenario})`,
            timestamp: summary.startedAt,
          },
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `System prompt:\n\n${systemPrompt}`,
            timestamp: summary.startedAt,
          },
        ],
        draftAssistantText: "",
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel,
        isLoadingModelCatalog: true,
      };

      sessionsRef.current = {
        ...sessionsRef.current,
        [summary.sessionId]: initialSession,
      };

      setSessionsById((current) => {
        if (isStaleRepoOperation()) {
          return current;
        }
        return {
          ...current,
          [summary.sessionId]: initialSession,
        };
      });
      throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
      runOrchestratorSideEffect(
        "start-session-persist-initial-session",
        persistSessionSnapshot(initialSession),
        {
          tags: {
            repoPath,
            taskId,
            role,
            scenario: resolvedScenario,
            sessionId: summary.sessionId,
          },
        },
      );

      attachSessionListener(repoPath, summary.sessionId);

      if (isStaleRepoOperation()) {
        await captureOrchestratorFallback(
          "start-session-stop-on-stale-after-listener-attach",
          async () => adapter.stopSession(summary.sessionId),
          {
            tags: {
              repoPath,
              taskId,
              role,
              scenario: resolvedScenario,
              sessionId: summary.sessionId,
            },
            fallback: () => undefined,
          },
        );
        throw new Error(STALE_START_ERROR);
      }

      const warmSessionData = (): void => {
        runOrchestratorSideEffect(
          "start-session-warm-session-todos",
          loadSessionTodos(
            summary.sessionId,
            runtime.baseUrl,
            runtime.workingDirectory,
            summary.externalSessionId,
          ),
          {
            tags: {
              repoPath,
              taskId,
              role,
              scenario: resolvedScenario,
              sessionId: summary.sessionId,
              externalSessionId: summary.externalSessionId,
            },
          },
        );
        runOrchestratorSideEffect(
          "start-session-warm-session-model-catalog",
          loadSessionModelCatalog(summary.sessionId, runtime.baseUrl, runtime.workingDirectory),
          {
            tags: {
              repoPath,
              taskId,
              role,
              scenario: resolvedScenario,
              sessionId: summary.sessionId,
            },
          },
        );
      };
      warmSessionData();

      const applyResolvedModelSelection = (resolvedModel: AgentModelSelection | null): void => {
        if (isStaleRepoOperation() || !resolvedModel) {
          return;
        }

        setSessionsById((current) => {
          const currentSession = current[summary.sessionId];
          if (!currentSession || currentSession.selectedModel) {
            return current;
          }

          const nextSession: AgentSessionState = {
            ...currentSession,
            selectedModel: resolvedModel,
          };
          const nextSessions = {
            ...current,
            [summary.sessionId]: nextSession,
          };
          sessionsRef.current = nextSessions;
          return nextSessions;
        });
      };

      if (!selectedModel) {
        if (requireModelReady) {
          const resolvedModel = await captureOrchestratorFallback<AgentModelSelection | null>(
            "start-session-await-default-model-selection",
            async () => defaultModelSelectionPromise,
            {
              tags: {
                repoPath,
                taskId,
                role,
                scenario: resolvedScenario,
                sessionId: summary.sessionId,
              },
              fallback: () => null,
            },
          );
          throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
          applyResolvedModelSelection(resolvedModel);
        } else {
          runOrchestratorSideEffect(
            "start-session-apply-default-model-selection",
            defaultModelSelectionPromise.then((defaultModelSelection) => {
              applyResolvedModelSelection(defaultModelSelection);
            }),
            {
              tags: {
                repoPath,
                taskId,
                role,
                scenario: resolvedScenario,
                sessionId: summary.sessionId,
              },
            },
          );
        }
      }

      if (sendKickoff) {
        throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
        await sendAgentMessage(summary.sessionId, kickoffPrompt(role, resolvedScenario, task.id));
        throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
        runOrchestratorSideEffect(
          "start-session-refresh-task-data-after-kickoff",
          refreshTaskData(repoPath),
          {
            tags: {
              repoPath,
              taskId,
              role,
              scenario: resolvedScenario,
              sessionId: summary.sessionId,
            },
          },
        );
      }

      return summary.sessionId;
    })();

    inFlightStartsByRepoTaskRef.current.set(inFlightKey, startPromise);
    try {
      return await startPromise;
    } finally {
      const currentInFlight = inFlightStartsByRepoTaskRef.current.get(inFlightKey);
      if (currentInFlight === startPromise) {
        inFlightStartsByRepoTaskRef.current.delete(inFlightKey);
      }
    }
  };
};
