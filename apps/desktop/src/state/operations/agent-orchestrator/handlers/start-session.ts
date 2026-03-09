import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentScenario } from "@openducktor/core";
import { assertAgentKickoffScenario, buildAgentSystemPrompt } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../host";
import { requireActiveRepo } from "../../task-operations-model";
import { type RuntimeInfo, resolveRuntimeConnection } from "../runtime/runtime";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../support/async-side-effects";
import {
  createRepoStaleGuard,
  inferScenario,
  kickoffPromptWithTaskContext,
  throwIfRepoStale,
} from "../support/utils";
import type {
  ModelDependencies,
  ResolvedRuntimeAndModel,
  RuntimeDependencies,
  SessionDependencies,
  SessionStartTags,
  StartAgentSessionInput,
  StartedSessionContext,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionCreationInput,
  StartSessionDependencies,
  StartSessionExecutionDependencies,
  TaskDependencies,
} from "./start-session.types";
import { createSessionStartTags, pickLatestSession } from "./start-session-support";

export type { StartAgentSessionInput, StartSessionDependencies } from "./start-session.types";

const STALE_START_ERROR = "Workspace changed while starting session.";

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
  requireModelReady,
  workingDirectoryOverride,
  requestedRuntimeKind,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  scenario: AgentScenario | undefined;
  requireModelReady: boolean;
  workingDirectoryOverride?: string | null;
  requestedRuntimeKind?: AgentModelSelection["runtimeKind"] | null;
  taskCard: TaskCard;
  deps: Pick<StartSessionExecutionDependencies, "runtime" | "task" | "model">;
}): Promise<ResolvedRuntimeAndModel> => {
  const docsPromise = deps.task.loadTaskDocuments(ctx.repoPath, ctx.taskId);
  const runtimePromise = deps.runtime.ensureRuntime(ctx.repoPath, ctx.taskId, ctx.role, {
    ...(workingDirectoryOverride !== undefined ? { workingDirectoryOverride } : {}),
    ...(requestedRuntimeKind ? { runtimeKind: requestedRuntimeKind } : {}),
  });
  const defaultModelSelectionPromise = deps.model.loadRepoDefaultModel(ctx.repoPath, ctx.role);
  const promptOverridesPromise = deps.model.loadRepoPromptOverrides(ctx.repoPath);

  const [docs, runtimeInfo, promptOverrides] = await Promise.all([
    docsPromise,
    runtimePromise,
    promptOverridesPromise,
  ]);
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const resolvedScenario = scenario ?? inferScenario(ctx.role, taskCard, docs);
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  let resolvedDefaultModelSelection: AgentModelSelection | null = null;
  if (requireModelReady) {
    try {
      resolvedDefaultModelSelection = await defaultModelSelectionPromise;
    } catch (error) {
      throw new Error(
        `Failed to load the default model for ${ctx.role} session start: ${errorMessage(error)}`,
      );
    }
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
  }

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
    overrides: promptOverrides,
  });

  return {
    taskCard,
    runtime: runtimeInfo,
    resolvedScenario,
    systemPrompt,
    promptOverrides,
    defaultModelSelectionPromise,
    resolvedDefaultModelSelection,
  };
};

const buildInitialSession = ({
  startedCtx,
  selectedModel,
  runtime,
  systemPrompt,
  promptOverrides,
}: {
  startedCtx: StartedSessionContext;
  selectedModel: AgentModelSelection | null;
  runtime: RuntimeInfo;
  systemPrompt: string;
  promptOverrides: ResolvedRuntimeAndModel["promptOverrides"];
}): AgentSessionState => ({
  sessionId: startedCtx.summary.sessionId,
  externalSessionId: startedCtx.summary.externalSessionId,
  taskId: startedCtx.taskId,
  runtimeKind: runtime.runtimeKind ?? selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
  role: startedCtx.role,
  scenario: startedCtx.resolvedScenario,
  status: "idle",
  startedAt: startedCtx.summary.startedAt,
  runtimeId: runtime.runtimeId,
  runId: runtime.runId,
  runtimeEndpoint: runtime.runtimeEndpoint,
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
  promptOverrides,
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

const canReuseSessionForSelectedModel = ({
  sessionRuntimeKind,
  selectedModel,
}: {
  sessionRuntimeKind: AgentModelSelection["runtimeKind"] | undefined;
  selectedModel: AgentModelSelection | null;
}): boolean => {
  const requestedRuntimeKind = selectedModel?.runtimeKind;
  if (!requestedRuntimeKind) {
    return true;
  }

  return (sessionRuntimeKind ?? DEFAULT_RUNTIME_KIND) === requestedRuntimeKind;
};

const normalizeWorkingDirectory = (workingDirectory: string | null | undefined): string => {
  let normalized = workingDirectory?.trim() ?? "";
  while (normalized.length > 1 && /[\\/]/.test(normalized.at(-1) ?? "")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

const applySelectedModelToReusedSession = ({
  repoPath,
  sessionId,
  selectedModel,
  session,
}: {
  repoPath: string;
  sessionId: string;
  selectedModel: AgentModelSelection | null;
  session: SessionDependencies;
}): void => {
  if (!selectedModel) {
    return;
  }

  const currentSession = session.sessionsRef.current[sessionId];
  if (!currentSession) {
    return;
  }
  if (
    currentSession.selectedModel?.runtimeKind === selectedModel.runtimeKind &&
    currentSession.selectedModel?.providerId === selectedModel.providerId &&
    currentSession.selectedModel?.modelId === selectedModel.modelId &&
    currentSession.selectedModel?.variant === selectedModel.variant &&
    currentSession.selectedModel?.profileId === selectedModel.profileId
  ) {
    return;
  }

  const nextSession: AgentSessionState = {
    ...currentSession,
    selectedModel,
  };
  const summary = {
    sessionId: currentSession.sessionId,
    externalSessionId: currentSession.externalSessionId,
    role: currentSession.role,
    scenario: currentSession.scenario,
    startedAt: currentSession.startedAt,
    status: currentSession.status,
    ...(currentSession.runtimeKind ? { runtimeKind: currentSession.runtimeKind } : {}),
  };
  session.setSessionsById((current) => ({
    ...current,
    [sessionId]: nextSession,
  }));
  persistInitialSession({
    initialSession: nextSession,
    session,
    tags: createSessionStartTags({
      repoPath,
      taskId: currentSession.taskId,
      role: currentSession.role,
      resolvedScenario: currentSession.scenario,
      summary,
      isStaleRepoOperation: () => false,
    }),
  });
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
  const validatedTaskCard = ctx.role === "qa" ? resolveStartTask({ ctx, task: deps.task }) : null;
  const resolvedWorkingDirectoryOverride =
    ctx.role === "qa"
      ? normalizeWorkingDirectory(input.workingDirectoryOverride) ||
        (await deps.runtime.resolveQaReviewTarget(ctx.repoPath, ctx.taskId))
      : input.workingDirectoryOverride;
  const expectedWorkingDirectory =
    ctx.role === "qa" ? normalizeWorkingDirectory(resolvedWorkingDirectoryOverride) : "";

  if (input.startMode === "reuse_latest") {
    const existingSession = pickLatestSession(
      Object.values(deps.session.sessionsRef.current).filter(
        (entry) => entry.taskId === ctx.taskId && entry.role === ctx.role,
      ),
    );
    if (existingSession) {
      if (
        (ctx.role !== "qa" ||
          normalizeWorkingDirectory(existingSession.workingDirectory) ===
            expectedWorkingDirectory) &&
        canReuseSessionForSelectedModel({
          sessionRuntimeKind:
            existingSession.runtimeKind ??
            existingSession.selectedModel?.runtimeKind ??
            DEFAULT_RUNTIME_KIND,
          selectedModel: input.selectedModel,
        })
      ) {
        applySelectedModelToReusedSession({
          repoPath: ctx.repoPath,
          sessionId: existingSession.sessionId,
          selectedModel: input.selectedModel,
          session: deps.session,
        });
        return {
          kind: "reused",
          sessionId: existingSession.sessionId,
        };
      }
    }

    const persistedSessions = await host.agentSessionsList(ctx.repoPath, ctx.taskId);
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
    const latestPersistedSession = pickLatestSession(
      persistedSessions.filter((entry) => entry.role === ctx.role),
    );
    if (
      latestPersistedSession &&
      (ctx.role !== "qa" ||
        normalizeWorkingDirectory(latestPersistedSession.workingDirectory) ===
          expectedWorkingDirectory) &&
      canReuseSessionForSelectedModel({
        sessionRuntimeKind:
          latestPersistedSession.runtimeKind ??
          latestPersistedSession.selectedModel?.runtimeKind ??
          DEFAULT_RUNTIME_KIND,
        selectedModel: input.selectedModel,
      })
    ) {
      if (!deps.session.sessionsRef.current[latestPersistedSession.sessionId]) {
        await deps.session.loadAgentSessions(ctx.taskId, {
          hydrateHistoryForSessionId: latestPersistedSession.sessionId,
        });
        throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
      }
      applySelectedModelToReusedSession({
        repoPath: ctx.repoPath,
        sessionId: latestPersistedSession.sessionId,
        selectedModel: input.selectedModel,
        session: deps.session,
      });
      return {
        kind: "reused",
        sessionId: latestPersistedSession.sessionId,
      };
    }
  }

  const taskCard = validatedTaskCard ?? resolveStartTask({ ctx, task: deps.task });
  const resolved = await resolveRuntimeAndModel({
    ctx,
    scenario: input.scenario,
    requireModelReady: input.requireModelReady && input.selectedModel == null,
    requestedRuntimeKind: input.selectedModel?.runtimeKind ?? null,
    ...(resolvedWorkingDirectoryOverride !== undefined
      ? { workingDirectoryOverride: resolvedWorkingDirectoryOverride }
      : {}),
    taskCard,
    deps,
  });

  const selectedModel = input.selectedModel ?? resolved.resolvedDefaultModelSelection;
  const summary = await deps.runtime.adapter.startSession({
    repoPath: ctx.repoPath,
    runtimeKind: resolved.runtime.runtimeKind ?? selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
    runtimeConnection: resolveRuntimeConnection(resolved.runtime),
    workingDirectory: resolved.runtime.workingDirectory,
    taskId: ctx.taskId,
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    systemPrompt: resolved.systemPrompt,
    ...(selectedModel ? { model: selectedModel } : {}),
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
    selectedModel: input.selectedModel ?? resolved.resolvedDefaultModelSelection,
    runtime: resolved.runtime,
    systemPrompt: resolved.systemPrompt,
    promptOverrides: resolved.promptOverrides,
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
    taskCard: resolved.taskCard,
    ctx: startedCtx,
    promptOverrides: resolved.promptOverrides,
    defaultModelSelectionPromise: resolved.defaultModelSelectionPromise,
    resolvedDefaultModelSelection: resolved.resolvedDefaultModelSelection,
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
  const runtimeConnection = resolveRuntimeConnection(runtimeInfo);
  const runtimeKind = runtimeInfo.runtimeKind ?? startedCtx.summary.runtimeKind;
  if (!runtimeKind) {
    throw new Error(`Runtime kind is required to warm session '${startedCtx.summary.sessionId}'.`);
  }

  runOrchestratorSideEffect(
    "start-session-warm-session-todos",
    model.loadSessionTodos(
      startedCtx.summary.sessionId,
      runtimeKind,
      runtimeConnection,
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
    model.loadSessionModelCatalog(startedCtx.summary.sessionId, runtimeKind, runtimeConnection),
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
    let resolvedModel: AgentModelSelection | null;
    try {
      resolvedModel = await defaultModelSelectionPromise;
    } catch (error) {
      throw new Error(
        `Failed to load the default model for ${startedCtx.role} session start: ${errorMessage(error)}`,
      );
    }
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
  taskCard,
  promptOverrides,
}: {
  sendKickoff: boolean;
  startedCtx: StartedSessionContext;
  task: TaskDependencies;
  taskCard: TaskCard;
  promptOverrides: ResolvedRuntimeAndModel["promptOverrides"];
}): Promise<void> => {
  if (!sendKickoff) {
    return;
  }

  const kickoffScenario = assertAgentKickoffScenario(startedCtx.resolvedScenario);

  throwIfRepoStale(startedCtx.isStaleRepoOperation, STALE_START_ERROR);
  await task.sendAgentMessage(
    startedCtx.summary.sessionId,
    kickoffPromptWithTaskContext(
      startedCtx.role,
      kickoffScenario,
      {
        taskId: startedCtx.taskId,
        title: taskCard.title,
        issueType: taskCard.issueType,
        status: taskCard.status,
        qaRequired: taskCard.aiReviewEnabled,
        description: taskCard.description,
        acceptanceCriteria: taskCard.acceptanceCriteria,
      },
      promptOverrides,
    ),
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
    workingDirectoryOverride = null,
  }: StartAgentSessionInput): Promise<string> => {
    const repoPath = requireActiveRepo(repo.activeRepo);
    const normalizedWorkingDirectoryOverride = workingDirectoryOverride?.trim() ?? "";
    const inFlightKey = `${repoPath}::${taskId}::${role}::${startMode}::${normalizedWorkingDirectoryOverride}`;
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
          requireModelReady,
          workingDirectoryOverride,
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
        selectedModel: selectedModel ?? startResult.resolvedDefaultModelSelection,
        requireModelReady,
        defaultModelSelectionPromise: startResult.defaultModelSelectionPromise,
        startedCtx: startResult.ctx,
        session,
      });

      await maybeSendKickoff({
        sendKickoff,
        startedCtx: startResult.ctx,
        task,
        taskCard: startResult.taskCard,
        promptOverrides: startResult.promptOverrides,
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
