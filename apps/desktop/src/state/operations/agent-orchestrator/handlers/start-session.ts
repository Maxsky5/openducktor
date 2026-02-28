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

type SessionStateById = Record<string, AgentSessionState>;
type SessionStateUpdater = SessionStateById | ((current: SessionStateById) => SessionStateById);

type SessionDependencies = {
  setSessionsById: (updater: SessionStateUpdater) => void;
  sessionsRef: { current: SessionStateById };
  inFlightStartsByRepoTaskRef: { current: Map<string, Promise<string>> };
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  persistSessionSnapshot: (session: AgentSessionState) => Promise<void>;
  attachSessionListener: (repoPath: string, sessionId: string) => void;
};

type RuntimeDependencies = {
  adapter: AgentEnginePort;
  ensureRuntime: (repoPath: string, taskId: string, role: AgentRole) => Promise<RuntimeInfo>;
};

type TaskDependencies = {
  taskRef: { current: TaskCard[] };
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  refreshTaskData: (repoPath: string) => Promise<void>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
};

type ModelDependencies = {
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
};

type RepoDependencies = {
  activeRepo: string | null;
  repoEpochRef: { current: number };
  previousRepoRef: { current: string | null };
};

type StartSessionDependencies = {
  repo: RepoDependencies;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
  task: TaskDependencies;
  model: ModelDependencies;
};

const STALE_START_ERROR = "Workspace changed while starting session.";
type RepoStaleGuard = () => boolean;
type SessionStartSummary = Awaited<ReturnType<AgentEnginePort["startSession"]>>;

type SessionStartTags = {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  sessionId: string;
};

type ResolvedRuntimeAndModel = {
  task: TaskCard;
  runtime: RuntimeInfo;
  resolvedScenario: AgentScenario;
  systemPrompt: string;
  defaultModelSelectionPromise: Promise<AgentModelSelection | null>;
};

type StartOrReuseResult =
  | {
      kind: "reused";
      sessionId: string;
    }
  | {
      kind: "started";
      task: TaskCard;
      runtime: RuntimeInfo;
      summary: SessionStartSummary;
      resolvedScenario: AgentScenario;
      defaultModelSelectionPromise: Promise<AgentModelSelection | null>;
    };

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

const createSessionStartTags = ({
  repoPath,
  taskId,
  role,
  scenario,
  sessionId,
}: SessionStartTags): SessionStartTags => ({
  repoPath,
  taskId,
  role,
  scenario,
  sessionId,
});

const stopSessionOnStaleAndThrow = async ({
  reason,
  runtime,
  tags,
}: {
  reason: string;
  runtime: RuntimeDependencies;
  tags: SessionStartTags;
}): Promise<never> => {
  await captureOrchestratorFallback(
    reason,
    async () => runtime.adapter.stopSession(tags.sessionId),
    {
      tags,
      fallback: () => undefined,
    },
  );
  throw new Error(STALE_START_ERROR);
};

const resolveStartTask = ({
  taskId,
  role,
  task,
}: {
  taskId: string;
  role: AgentRole;
  task: TaskDependencies;
}): TaskCard => {
  const resolvedTask = task.taskRef.current.find((entry) => entry.id === taskId);
  if (!resolvedTask) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (!isRoleAvailableForTask(resolvedTask, role)) {
    throw new Error(unavailableRoleErrorMessage(resolvedTask, role));
  }
  return resolvedTask;
};

const resolveRuntimeAndModel = async ({
  repoPath,
  taskId,
  role,
  scenario,
  taskCard,
  runtime,
  task,
  model,
  isStaleRepoOperation,
}: {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario | undefined;
  taskCard: TaskCard;
  runtime: RuntimeDependencies;
  task: TaskDependencies;
  model: ModelDependencies;
  isStaleRepoOperation: RepoStaleGuard;
}): Promise<ResolvedRuntimeAndModel> => {
  const docsPromise = task.loadTaskDocuments(repoPath, taskId);
  const runtimePromise = runtime.ensureRuntime(repoPath, taskId, role);
  const defaultModelSelectionPromise = model.loadRepoDefaultModel(repoPath, role);

  const [docs, runtimeInfo] = await Promise.all([docsPromise, runtimePromise]);
  throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);

  const resolvedScenario = scenario ?? inferScenario(role, taskCard, docs);
  throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);

  const systemPrompt = buildAgentSystemPrompt({
    role,
    scenario: resolvedScenario,
    task: {
      taskId: taskCard.id,
      title: taskCard.title,
      issueType: taskCard.issueType,
      status: taskCard.status,
      qaRequired: taskCard.aiReviewEnabled,
      description: taskCard.description,
      acceptanceCriteria: taskCard.acceptanceCriteria,
      specMarkdown: docs.specMarkdown,
      planMarkdown: docs.planMarkdown,
      latestQaReportMarkdown: docs.qaMarkdown,
    },
  });

  return {
    task: taskCard,
    runtime: runtimeInfo,
    resolvedScenario,
    systemPrompt,
    defaultModelSelectionPromise,
  };
};

const buildInitialSession = ({
  taskId,
  role,
  resolvedScenario,
  selectedModel,
  runtime,
  summary,
  systemPrompt,
}: {
  taskId: string;
  role: AgentRole;
  resolvedScenario: AgentScenario;
  selectedModel: AgentModelSelection | null;
  runtime: RuntimeInfo;
  summary: SessionStartSummary;
  systemPrompt: string;
}): AgentSessionState => ({
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
});

const persistInitialSession = ({
  initialSession,
  session,
  tags,
}: {
  initialSession: AgentSessionState;
  session: SessionDependencies;
  tags: SessionStartTags;
}): void => {
  runOrchestratorSideEffect(
    "start-session-persist-initial-session",
    session.persistSessionSnapshot(initialSession),
    { tags },
  );
};

const createOrReuseSession = async ({
  repoPath,
  taskId,
  role,
  scenario,
  selectedModel,
  startMode,
  session,
  runtime,
  task,
  model,
  isStaleRepoOperation,
}: {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario | undefined;
  selectedModel: AgentModelSelection | null;
  startMode: "reuse_latest" | "fresh";
  session: SessionDependencies;
  runtime: RuntimeDependencies;
  task: TaskDependencies;
  model: ModelDependencies;
  isStaleRepoOperation: RepoStaleGuard;
}): Promise<StartOrReuseResult> => {
  if (startMode === "reuse_latest") {
    const existingSession = pickLatestSession(
      Object.values(session.sessionsRef.current).filter(
        (entry) => entry.taskId === taskId && entry.role === role,
      ),
    );
    if (existingSession) {
      return {
        kind: "reused",
        sessionId: existingSession.sessionId,
      };
    }

    const persistedSessions = await host.agentSessionsList(repoPath, taskId);
    throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
    const latestPersistedSession = pickLatestSession(
      persistedSessions.filter((entry) => entry.role === role),
    );
    if (latestPersistedSession) {
      if (!session.sessionsRef.current[latestPersistedSession.sessionId]) {
        await session.loadAgentSessions(taskId, {
          hydrateHistoryForSessionId: latestPersistedSession.sessionId,
        });
        throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
      }
      return {
        kind: "reused",
        sessionId: latestPersistedSession.sessionId,
      };
    }
  }

  const taskCard = resolveStartTask({ taskId, role, task });
  const resolved = await resolveRuntimeAndModel({
    repoPath,
    taskId,
    role,
    scenario,
    taskCard,
    runtime,
    task,
    model,
    isStaleRepoOperation,
  });

  const summary = await runtime.adapter.startSession({
    repoPath,
    workingDirectory: resolved.runtime.workingDirectory,
    taskId,
    role,
    scenario: resolved.resolvedScenario,
    systemPrompt: resolved.systemPrompt,
    baseUrl: resolved.runtime.baseUrl,
  });

  const sessionTags = createSessionStartTags({
    repoPath,
    taskId,
    role,
    scenario: resolved.resolvedScenario,
    sessionId: summary.sessionId,
  });

  if (isStaleRepoOperation()) {
    await stopSessionOnStaleAndThrow({
      reason: "start-session-stop-on-stale-after-start",
      runtime,
      tags: sessionTags,
    });
  }

  const initialSession = buildInitialSession({
    taskId,
    role,
    resolvedScenario: resolved.resolvedScenario,
    selectedModel,
    runtime: resolved.runtime,
    summary,
    systemPrompt: resolved.systemPrompt,
  });

  session.sessionsRef.current = {
    ...session.sessionsRef.current,
    [summary.sessionId]: initialSession,
  };
  session.setSessionsById((current) => {
    if (isStaleRepoOperation()) {
      return current;
    }
    return {
      ...current,
      [summary.sessionId]: initialSession,
    };
  });
  throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);

  persistInitialSession({
    initialSession,
    session,
    tags: sessionTags,
  });

  return {
    kind: "started",
    task: resolved.task,
    runtime: resolved.runtime,
    summary,
    resolvedScenario: resolved.resolvedScenario,
    defaultModelSelectionPromise: resolved.defaultModelSelectionPromise,
  };
};

const attachSessionListenerAndGuard = async ({
  repoPath,
  taskId,
  role,
  resolvedScenario,
  summary,
  session,
  runtime,
  isStaleRepoOperation,
}: {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  resolvedScenario: AgentScenario;
  summary: SessionStartSummary;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
  isStaleRepoOperation: RepoStaleGuard;
}): Promise<void> => {
  session.attachSessionListener(repoPath, summary.sessionId);

  if (!isStaleRepoOperation()) {
    return;
  }

  await stopSessionOnStaleAndThrow({
    reason: "start-session-stop-on-stale-after-listener-attach",
    runtime,
    tags: createSessionStartTags({
      repoPath,
      taskId,
      role,
      scenario: resolvedScenario,
      sessionId: summary.sessionId,
    }),
  });
};

const warmSessionData = ({
  taskId,
  role,
  repoPath,
  resolvedScenario,
  runtime,
  summary,
  model,
}: {
  taskId: string;
  role: AgentRole;
  repoPath: string;
  resolvedScenario: AgentScenario;
  runtime: RuntimeInfo;
  summary: SessionStartSummary;
  model: ModelDependencies;
}): void => {
  const tags = createSessionStartTags({
    repoPath,
    taskId,
    role,
    scenario: resolvedScenario,
    sessionId: summary.sessionId,
  });

  runOrchestratorSideEffect(
    "start-session-warm-session-todos",
    model.loadSessionTodos(
      summary.sessionId,
      runtime.baseUrl,
      runtime.workingDirectory,
      summary.externalSessionId,
    ),
    {
      tags: {
        ...tags,
        externalSessionId: summary.externalSessionId,
      },
    },
  );

  runOrchestratorSideEffect(
    "start-session-warm-session-model-catalog",
    model.loadSessionModelCatalog(summary.sessionId, runtime.baseUrl, runtime.workingDirectory),
    { tags },
  );
};

const applyResolvedModelSelection = ({
  resolvedModel,
  summary,
  session,
  isStaleRepoOperation,
}: {
  resolvedModel: AgentModelSelection | null;
  summary: SessionStartSummary;
  session: SessionDependencies;
  isStaleRepoOperation: RepoStaleGuard;
}): void => {
  if (isStaleRepoOperation() || !resolvedModel) {
    return;
  }

  session.setSessionsById((current) => {
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
    session.sessionsRef.current = nextSessions;
    return nextSessions;
  });
};

const maybeApplyDefaultModelSelection = async ({
  selectedModel,
  requireModelReady,
  defaultModelSelectionPromise,
  repoPath,
  taskId,
  role,
  resolvedScenario,
  summary,
  session,
  isStaleRepoOperation,
}: {
  selectedModel: AgentModelSelection | null;
  requireModelReady: boolean;
  defaultModelSelectionPromise: Promise<AgentModelSelection | null>;
  repoPath: string;
  taskId: string;
  role: AgentRole;
  resolvedScenario: AgentScenario;
  summary: SessionStartSummary;
  session: SessionDependencies;
  isStaleRepoOperation: RepoStaleGuard;
}): Promise<void> => {
  if (selectedModel) {
    return;
  }

  const tags = createSessionStartTags({
    repoPath,
    taskId,
    role,
    scenario: resolvedScenario,
    sessionId: summary.sessionId,
  });

  if (requireModelReady) {
    const resolvedModel = await captureOrchestratorFallback<AgentModelSelection | null>(
      "start-session-await-default-model-selection",
      async () => defaultModelSelectionPromise,
      {
        tags,
        fallback: () => null,
      },
    );
    throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
    applyResolvedModelSelection({
      resolvedModel,
      summary,
      session,
      isStaleRepoOperation,
    });
    return;
  }

  runOrchestratorSideEffect(
    "start-session-apply-default-model-selection",
    defaultModelSelectionPromise.then((defaultModelSelection) => {
      applyResolvedModelSelection({
        resolvedModel: defaultModelSelection,
        summary,
        session,
        isStaleRepoOperation,
      });
    }),
    { tags },
  );
};

const maybeSendKickoff = async ({
  sendKickoff,
  repoPath,
  taskId,
  role,
  resolvedScenario,
  summary,
  task,
  isStaleRepoOperation,
}: {
  sendKickoff: boolean;
  repoPath: string;
  taskId: string;
  role: AgentRole;
  resolvedScenario: AgentScenario;
  summary: SessionStartSummary;
  task: TaskDependencies;
  isStaleRepoOperation: RepoStaleGuard;
}): Promise<void> => {
  if (!sendKickoff) {
    return;
  }

  throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
  await task.sendAgentMessage(summary.sessionId, kickoffPrompt(role, resolvedScenario, taskId));
  throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);
  runOrchestratorSideEffect(
    "start-session-refresh-task-data-after-kickoff",
    task.refreshTaskData(repoPath),
    {
      tags: createSessionStartTags({
        repoPath,
        taskId,
        role,
        scenario: resolvedScenario,
        sessionId: summary.sessionId,
      }),
    },
  );
};

export const createStartAgentSession = ({
  repo,
  session,
  runtime,
  task,
  model,
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
    const repoPath = requireActiveRepo(repo.activeRepo);
    const inFlightKey = `${repoPath}::${taskId}::${role}::${startMode}`;
    const existingInFlight = session.inFlightStartsByRepoTaskRef.current.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const startPromise = (async (): Promise<string> => {
      const isStaleRepoOperation = createRepoStaleGuard({
        repoPath,
        repoEpochRef: repo.repoEpochRef,
        previousRepoRef: repo.previousRepoRef,
      });
      throwIfRepoStale(isStaleRepoOperation, STALE_START_ERROR);

      const startResult = await createOrReuseSession({
        repoPath,
        taskId,
        role,
        scenario,
        selectedModel,
        startMode,
        session,
        runtime,
        task,
        model,
        isStaleRepoOperation,
      });
      if (startResult.kind === "reused") {
        return startResult.sessionId;
      }

      await attachSessionListenerAndGuard({
        repoPath,
        taskId,
        role,
        resolvedScenario: startResult.resolvedScenario,
        summary: startResult.summary,
        session,
        runtime,
        isStaleRepoOperation,
      });

      warmSessionData({
        taskId,
        role,
        repoPath,
        resolvedScenario: startResult.resolvedScenario,
        runtime: startResult.runtime,
        summary: startResult.summary,
        model,
      });

      await maybeApplyDefaultModelSelection({
        selectedModel,
        requireModelReady,
        defaultModelSelectionPromise: startResult.defaultModelSelectionPromise,
        repoPath,
        taskId,
        role,
        resolvedScenario: startResult.resolvedScenario,
        summary: startResult.summary,
        session,
        isStaleRepoOperation,
      });

      await maybeSendKickoff({
        sendKickoff,
        repoPath,
        taskId: startResult.task.id,
        role,
        resolvedScenario: startResult.resolvedScenario,
        summary: startResult.summary,
        task,
        isStaleRepoOperation,
      });

      return startResult.summary.sessionId;
    })();

    session.inFlightStartsByRepoTaskRef.current.set(inFlightKey, startPromise);
    try {
      return await startPromise;
    } finally {
      const currentInFlight = session.inFlightStartsByRepoTaskRef.current.get(inFlightKey);
      if (currentInFlight === startPromise) {
        session.inFlightStartsByRepoTaskRef.current.delete(inFlightKey);
      }
    }
  };
};
