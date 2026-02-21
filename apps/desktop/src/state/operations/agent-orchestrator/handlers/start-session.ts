import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { buildAgentSystemPrompt } from "@openducktor/core";
import { host } from "../../host";
import type { RuntimeInfo, TaskDocuments } from "../runtime/runtime";
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
  sendKickoff?: boolean;
};

type StartSessionDependencies = {
  activeRepo: string | null;
  adapter: OpencodeSdkAdapter;
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
  loadAgentSessions: (taskId: string) => Promise<void>;
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
    sendKickoff = false,
  }: StartAgentSessionInput): Promise<string> => {
    if (!activeRepo) {
      throw new Error("Select a workspace first.");
    }

    const repoPath = activeRepo;
    const inFlightKey = `${repoPath}::${taskId}`;
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

      const existingSession = pickLatestSession(
        Object.values(sessionsRef.current).filter((entry) => entry.taskId === taskId),
      );
      if (existingSession) {
        return existingSession.sessionId;
      }

      const persistedSessions = await host.agentSessionsList(repoPath, taskId);
      throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
      const latestPersistedSession = pickLatestSession(persistedSessions);
      if (latestPersistedSession) {
        if (!sessionsRef.current[latestPersistedSession.sessionId]) {
          await loadAgentSessions(taskId);
          throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
        }
        return latestPersistedSession.sessionId;
      }

      const task = taskRef.current.find((entry) => entry.id === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const docs = await loadTaskDocuments(repoPath, taskId);
      throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
      const resolvedScenario = scenario ?? inferScenario(role, task, docs);
      const runtime = await ensureRuntime(repoPath, taskId, role);
      throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
      const defaultModelSelection = await loadRepoDefaultModel(repoPath, role);
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
        await adapter.stopSession(summary.sessionId).catch(() => undefined);
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
        selectedModel: defaultModelSelection,
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
      void persistSessionSnapshot(initialSession).catch(() => undefined);

      attachSessionListener(repoPath, summary.sessionId);

      if (isStaleRepoOperation()) {
        await adapter.stopSession(summary.sessionId).catch(() => undefined);
        throw new Error(STALE_START_ERROR);
      }

      const warmSessionData = (): void => {
        void loadSessionTodos(
          summary.sessionId,
          runtime.baseUrl,
          runtime.workingDirectory,
          summary.externalSessionId,
        ).catch(() => undefined);
        void loadSessionModelCatalog(
          summary.sessionId,
          runtime.baseUrl,
          runtime.workingDirectory,
        ).catch(() => undefined);
      };
      warmSessionData();

      if (sendKickoff) {
        throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
        await sendAgentMessage(summary.sessionId, kickoffPrompt(role, resolvedScenario, task.id));
        throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
        await refreshTaskData(repoPath);
        throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
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
