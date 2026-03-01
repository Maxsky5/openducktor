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

export type StartSessionDependencies = {
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

type StartSessionContext = {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  isStaleRepoOperation: RepoStaleGuard;
};

type StartedSessionContext = StartSessionContext & {
  summary: SessionStartSummary;
  resolvedScenario: AgentScenario;
};

type StartSessionExecutionDependencies = Pick<
  StartSessionDependencies,
  "session" | "runtime" | "task" | "model"
>;

type StartSessionCreationInput = {
  scenario: AgentScenario | undefined;
  selectedModel: AgentModelSelection | null;
  startMode: "reuse_latest" | "fresh";
};

type ResolvedRuntimeAndModel = {
  taskCard: TaskCard;
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
      runtimeInfo: RuntimeInfo;
      ctx: StartedSessionContext;
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
  resolvedScenario,
  summary,
}: StartedSessionContext): SessionStartTags => ({
  repoPath,
  taskId,
  role,
  scenario: resolvedScenario,
  sessionId: summary.sessionId,
});

const stopSessionOnStaleAndThrow = async ({
  reason,
  runtime,
  startedCtx,
}: {
  reason: string;
  runtime: RuntimeDependencies;
  startedCtx: StartedSessionContext;
}): Promise<never> => {
  const tags = createSessionStartTags(startedCtx);
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
  ctx,
  task,
}: {
  ctx: StartSessionContext;
  task: TaskDependencies;
}): TaskCard => {
  const resolvedTask = task.taskRef.current.find((entry) => entry.id === ctx.taskId);
  if (!resolvedTask) {
    throw new Error(`Task not found: ${ctx.taskId}`);
  }
  if (!isRoleAvailableForTask(resolvedTask, ctx.role)) {
    throw new Error(unavailableRoleErrorMessage(resolvedTask, ctx.role));
  }
  return resolvedTask;
};

const resolveRuntimeAndModel = async ({
  ctx,
  scenario,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  scenario: AgentScenario | undefined;
  taskCard: TaskCard;
  deps: Pick<StartSessionExecutionDependencies, "runtime" | "task" | "model">;
}): Promise<ResolvedRuntimeAndModel> => {
  const docsPromise = deps.task.loadTaskDocuments(ctx.repoPath, ctx.taskId);
  const runtimePromise = deps.runtime.ensureRuntime(ctx.repoPath, ctx.taskId, ctx.role);
  const defaultModelSelectionPromise = deps.model.loadRepoDefaultModel(ctx.repoPath, ctx.role);

  const [docs, runtimeInfo] = await Promise.all([docsPromise, runtimePromise]);
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const resolvedScenario = scenario ?? inferScenario(ctx.role, taskCard, docs);
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const systemPrompt = buildAgentSystemPrompt({
    role: ctx.role,
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
    taskCard,
    runtime: runtimeInfo,
    resolvedScenario,
    systemPrompt,
    defaultModelSelectionPromise,
  };
};

const buildInitialSession = ({
  startedCtx,
  selectedModel,
  runtime,
  systemPrompt,
}: {
  startedCtx: StartedSessionContext;
  selectedModel: AgentModelSelection | null;
  runtime: RuntimeInfo;
  systemPrompt: string;
}): AgentSessionState => ({
  sessionId: startedCtx.summary.sessionId,
  externalSessionId: startedCtx.summary.externalSessionId,
  taskId: startedCtx.taskId,
  role: startedCtx.role,
  scenario: startedCtx.resolvedScenario,
  status: "idle",
  startedAt: startedCtx.summary.startedAt,
  runtimeId: runtime.runtimeId,
  runId: runtime.runId,
  baseUrl: runtime.baseUrl,
  workingDirectory: runtime.workingDirectory,
  messages: [
    {
      id: crypto.randomUUID(),
      role: "system",
      content: `Session started (${startedCtx.role} - ${startedCtx.resolvedScenario})`,
      timestamp: startedCtx.summary.startedAt,
    },
    {
      id: crypto.randomUUID(),
      role: "system",
      content: `System prompt:\n\n${systemPrompt}`,
      timestamp: startedCtx.summary.startedAt,
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
  ctx,
  input,
  deps,
}: {
  ctx: StartSessionContext;
  input: StartSessionCreationInput;
  deps: StartSessionExecutionDependencies;
}): Promise<StartOrReuseResult> => {
  if (input.startMode === "reuse_latest") {
    const existingSession = pickLatestSession(
      Object.values(deps.session.sessionsRef.current).filter(
        (entry) => entry.taskId === ctx.taskId && entry.role === ctx.role,
      ),
    );
    if (existingSession) {
      return {
        kind: "reused",
        sessionId: existingSession.sessionId,
      };
    }

    const persistedSessions = await host.agentSessionsList(ctx.repoPath, ctx.taskId);
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
    const latestPersistedSession = pickLatestSession(
      persistedSessions.filter((entry) => entry.role === ctx.role),
    );
    if (latestPersistedSession) {
      if (!deps.session.sessionsRef.current[latestPersistedSession.sessionId]) {
        await deps.session.loadAgentSessions(ctx.taskId, {
          hydrateHistoryForSessionId: latestPersistedSession.sessionId,
        });
        throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
      }
      return {
        kind: "reused",
        sessionId: latestPersistedSession.sessionId,
      };
    }
  }

  const taskCard = resolveStartTask({ ctx, task: deps.task });
  const resolved = await resolveRuntimeAndModel({
    ctx,
    scenario: input.scenario,
    taskCard,
    deps,
  });

  const summary = await deps.runtime.adapter.startSession({
    repoPath: ctx.repoPath,
    workingDirectory: resolved.runtime.workingDirectory,
    taskId: ctx.taskId,
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    systemPrompt: resolved.systemPrompt,
    baseUrl: resolved.runtime.baseUrl,
  });

  const startedCtx: StartedSessionContext = {
    ...ctx,
    resolvedScenario: resolved.resolvedScenario,
    summary,
  };

  if (ctx.isStaleRepoOperation()) {
    await stopSessionOnStaleAndThrow({
      reason: "start-session-stop-on-stale-after-start",
      runtime: deps.runtime,
      startedCtx,
    });
  }

  const initialSession = buildInitialSession({
    startedCtx,
    selectedModel: input.selectedModel,
    runtime: resolved.runtime,
    systemPrompt: resolved.systemPrompt,
  });

  deps.session.setSessionsById((current) => {
    if (ctx.isStaleRepoOperation()) {
      return current;
    }
    const nextSessions = {
      ...current,
      [summary.sessionId]: initialSession,
    };
    return nextSessions;
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  persistInitialSession({
    initialSession,
    session: deps.session,
    tags: createSessionStartTags(startedCtx),
  });

  return {
    kind: "started",
    runtimeInfo: resolved.runtime,
    ctx: startedCtx,
    defaultModelSelectionPromise: resolved.defaultModelSelectionPromise,
  };
};

const attachSessionListenerAndGuard = async ({
  startedCtx,
  session,
  runtime,
}: {
  startedCtx: StartedSessionContext;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
}): Promise<void> => {
  session.attachSessionListener(startedCtx.repoPath, startedCtx.summary.sessionId);

  if (!startedCtx.isStaleRepoOperation()) {
    return;
  }

  await stopSessionOnStaleAndThrow({
    reason: "start-session-stop-on-stale-after-listener-attach",
    runtime,
    startedCtx,
  });
};

const warmSessionData = ({
  startedCtx,
  runtimeInfo,
  model,
}: {
  startedCtx: StartedSessionContext;
  runtimeInfo: RuntimeInfo;
  model: ModelDependencies;
}): void => {
  const tags = createSessionStartTags(startedCtx);

  runOrchestratorSideEffect(
    "start-session-warm-session-todos",
    model.loadSessionTodos(
      startedCtx.summary.sessionId,
      runtimeInfo.baseUrl,
      runtimeInfo.workingDirectory,
      startedCtx.summary.externalSessionId,
    ),
    {
      tags: {
        ...tags,
        externalSessionId: startedCtx.summary.externalSessionId,
      },
    },
  );

  runOrchestratorSideEffect(
    "start-session-warm-session-model-catalog",
    model.loadSessionModelCatalog(
      startedCtx.summary.sessionId,
      runtimeInfo.baseUrl,
      runtimeInfo.workingDirectory,
    ),
    { tags },
  );
};

const applyResolvedModelSelection = ({
  resolvedModel,
  startedCtx,
  session,
}: {
  resolvedModel: AgentModelSelection | null;
  startedCtx: StartedSessionContext;
  session: SessionDependencies;
}): void => {
  if (startedCtx.isStaleRepoOperation() || !resolvedModel) {
    return;
  }

  session.setSessionsById((current) => {
    const currentSession = current[startedCtx.summary.sessionId];
    if (!currentSession || currentSession.selectedModel) {
      return current;
    }

    const nextSession: AgentSessionState = {
      ...currentSession,
      selectedModel: resolvedModel,
    };
    const nextSessions = {
      ...current,
      [startedCtx.summary.sessionId]: nextSession,
    };
    return nextSessions;
  });
};

const maybeApplyDefaultModelSelection = async ({
  selectedModel,
  requireModelReady,
  defaultModelSelectionPromise,
  startedCtx,
  session,
}: {
  selectedModel: AgentModelSelection | null;
  requireModelReady: boolean;
  defaultModelSelectionPromise: Promise<AgentModelSelection | null>;
  startedCtx: StartedSessionContext;
  session: SessionDependencies;
}): Promise<void> => {
  if (selectedModel) {
    return;
  }

  const tags = createSessionStartTags(startedCtx);

  if (requireModelReady) {
    const resolvedModel = await captureOrchestratorFallback<AgentModelSelection | null>(
      "start-session-await-default-model-selection",
      async () => defaultModelSelectionPromise,
      {
        tags,
        fallback: () => null,
      },
    );
    throwIfRepoStale(startedCtx.isStaleRepoOperation, STALE_START_ERROR);
    applyResolvedModelSelection({
      resolvedModel,
      startedCtx,
      session,
    });
    return;
  }

  runOrchestratorSideEffect(
    "start-session-apply-default-model-selection",
    defaultModelSelectionPromise.then((defaultModelSelection) => {
      applyResolvedModelSelection({
        resolvedModel: defaultModelSelection,
        startedCtx,
        session,
      });
    }),
    { tags },
  );
};

const maybeSendKickoff = async ({
  sendKickoff,
  startedCtx,
  task,
}: {
  sendKickoff: boolean;
  startedCtx: StartedSessionContext;
  task: TaskDependencies;
}): Promise<void> => {
  if (!sendKickoff) {
    return;
  }

  throwIfRepoStale(startedCtx.isStaleRepoOperation, STALE_START_ERROR);
  await task.sendAgentMessage(
    startedCtx.summary.sessionId,
    kickoffPrompt(startedCtx.role, startedCtx.resolvedScenario, startedCtx.taskId),
  );
  throwIfRepoStale(startedCtx.isStaleRepoOperation, STALE_START_ERROR);
  runOrchestratorSideEffect(
    "start-session-refresh-task-data-after-kickoff",
    task.refreshTaskData(startedCtx.repoPath),
    {
      tags: createSessionStartTags(startedCtx),
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

      const startCtx: StartSessionContext = {
        repoPath,
        taskId,
        role,
        isStaleRepoOperation,
      };

      const startResult = await createOrReuseSession({
        ctx: startCtx,
        input: {
          scenario,
          selectedModel,
          startMode,
        },
        deps: {
          session,
          runtime,
          task,
          model,
        },
      });
      if (startResult.kind === "reused") {
        return startResult.sessionId;
      }

      await attachSessionListenerAndGuard({
        startedCtx: startResult.ctx,
        session,
        runtime,
      });

      warmSessionData({
        startedCtx: startResult.ctx,
        runtimeInfo: startResult.runtimeInfo,
        model,
      });

      await maybeApplyDefaultModelSelection({
        selectedModel,
        requireModelReady,
        defaultModelSelectionPromise: startResult.defaultModelSelectionPromise,
        startedCtx: startResult.ctx,
        session,
      });

      await maybeSendKickoff({
        sendKickoff,
        startedCtx: startResult.ctx,
        task,
      });

      return startResult.ctx.summary.sessionId;
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
