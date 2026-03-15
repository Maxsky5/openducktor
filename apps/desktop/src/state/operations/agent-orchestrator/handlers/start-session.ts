import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentScenario } from "@openducktor/core";
import { assertAgentKickoffScenario } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import { appQueryClient } from "@/lib/query-client";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import { agentSessionListQueryOptions } from "@/state/queries/agent-sessions";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireActiveRepo } from "../../task-operations-model";
import { type RuntimeInfo, resolveRuntimeConnection } from "../runtime/runtime";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../support/async-side-effects";
import { createRepoStaleGuard, normalizeWorkingDirectory, throwIfRepoStale } from "../support/core";
import { normalizePersistedSelection } from "../support/models";
import { inferScenario, kickoffPromptWithTaskContext } from "../support/scenario";
import {
  buildSessionPreludeMessages,
  createSessionPromptContext,
  loadSessionPromptInputs,
} from "../support/session-prompt";
import { warmSessionData } from "../support/session-warmup";
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
  const defaultModelSelectionPromise = deps.model.loadRepoDefaultModel(ctx.repoPath, ctx.role);
  const { documents: docs, promptOverrides } = await loadSessionPromptInputs({
    repoPath: ctx.repoPath,
    taskId: ctx.taskId,
    loadTaskDocuments: deps.task.loadTaskDocuments,
    loadRepoPromptOverrides: deps.model.loadRepoPromptOverrides,
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const resolvedScenario = scenario ?? inferScenario(ctx.role, taskCard, docs);
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const runtimeInfo = await deps.runtime.ensureRuntime(ctx.repoPath, ctx.taskId, ctx.role, {
    ...(workingDirectoryOverride !== undefined ? { workingDirectoryOverride } : {}),
    ...(requestedRuntimeKind ? { runtimeKind: requestedRuntimeKind } : {}),
  });
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

  const { systemPrompt } = createSessionPromptContext({
    role: ctx.role,
    scenario: resolvedScenario,
    task: taskCard,
    promptOverrides,
    documents: docs,
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
  messages: buildSessionPreludeMessages({
    sessionId: startedCtx.summary.sessionId,
    role: startedCtx.role,
    scenario: startedCtx.resolvedScenario,
    systemPrompt,
    startedAt: startedCtx.summary.startedAt,
  }),
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
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
  sessionSelectedModel,
  selectedModel,
}: {
  sessionRuntimeKind: AgentModelSelection["runtimeKind"] | undefined;
  sessionSelectedModel: AgentModelSelection | null | undefined;
  selectedModel: AgentModelSelection | null;
}): boolean => {
  const requestedRuntimeKind = selectedModel?.runtimeKind;
  if (!requestedRuntimeKind) {
    return true;
  }

  if ((sessionRuntimeKind ?? DEFAULT_RUNTIME_KIND) !== requestedRuntimeKind) {
    return false;
  }
  if (!selectedModel) {
    return true;
  }
  if (!sessionSelectedModel) {
    return true;
  }

  return (
    sessionSelectedModel.providerId === selectedModel.providerId &&
    sessionSelectedModel.modelId === selectedModel.modelId &&
    (selectedModel.variant ? sessionSelectedModel.variant === selectedModel.variant : true) &&
    (selectedModel.profileId ? sessionSelectedModel.profileId === selectedModel.profileId : true)
  );
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
  let resolvedQaWorkingDirectory: string | null = null;
  const resolveExpectedQaWorkingDirectory = async (): Promise<string> => {
    if (resolvedQaWorkingDirectory !== null) {
      return resolvedQaWorkingDirectory;
    }

    const overrideWorkingDirectory = normalizeWorkingDirectory(input.workingDirectoryOverride);
    resolvedQaWorkingDirectory =
      overrideWorkingDirectory ||
      (await deps.runtime.resolveQaReviewTarget(ctx.repoPath, ctx.taskId));
    return resolvedQaWorkingDirectory;
  };

  if (input.startMode === "reuse_latest") {
    const existingSession = pickLatestSession(
      Object.values(deps.session.sessionsRef.current).filter(
        (entry) => entry.taskId === ctx.taskId && entry.role === ctx.role,
      ),
    );
    if (existingSession) {
      const canReuseExistingSession = canReuseSessionForSelectedModel({
        sessionRuntimeKind:
          existingSession.runtimeKind ??
          existingSession.selectedModel?.runtimeKind ??
          DEFAULT_RUNTIME_KIND,
        sessionSelectedModel: existingSession.selectedModel,
        selectedModel: input.selectedModel,
      });
      const existingSessionMatchesQaTarget =
        ctx.role !== "qa" ||
        (canReuseExistingSession &&
          normalizeWorkingDirectory(existingSession.workingDirectory) ===
            (await resolveExpectedQaWorkingDirectory()));
      if (canReuseExistingSession && existingSessionMatchesQaTarget) {
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

    const persistedSessions = await appQueryClient.fetchQuery({
      ...agentSessionListQueryOptions(ctx.repoPath, ctx.taskId),
      staleTime: 0,
    });
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
    const latestPersistedSession = pickLatestSession(
      persistedSessions.filter((entry) => entry.role === ctx.role),
    );
    const canReusePersistedSession = latestPersistedSession
      ? canReuseSessionForSelectedModel({
          sessionRuntimeKind:
            latestPersistedSession.runtimeKind ??
            latestPersistedSession.selectedModel?.runtimeKind ??
            DEFAULT_RUNTIME_KIND,
          sessionSelectedModel: normalizePersistedSelection(latestPersistedSession.selectedModel),
          selectedModel: input.selectedModel,
        })
      : false;
    const persistedSessionMatchesQaTarget =
      ctx.role !== "qa" ||
      (latestPersistedSession !== undefined &&
        canReusePersistedSession &&
        normalizeWorkingDirectory(latestPersistedSession.workingDirectory) ===
          (await resolveExpectedQaWorkingDirectory()));
    if (latestPersistedSession && canReusePersistedSession && persistedSessionMatchesQaTarget) {
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
    ...(ctx.role === "qa"
      ? { workingDirectoryOverride: await resolveExpectedQaWorkingDirectory() }
      : input.workingDirectoryOverride !== undefined
        ? { workingDirectoryOverride: input.workingDirectoryOverride }
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

const warmStartedSession = ({
  startedCtx,
  runtimeInfo,
  model,
}: {
  startedCtx: StartedSessionContext;
  runtimeInfo: RuntimeInfo;
  model: ModelDependencies;
}): void => {
  const runtimeConnection = resolveRuntimeConnection(runtimeInfo);
  const runtimeKind = runtimeInfo.runtimeKind ?? startedCtx.summary.runtimeKind;
  if (!runtimeKind) {
    throw new Error(`Runtime kind is required to warm session '${startedCtx.summary.sessionId}'.`);
  }

  warmSessionData({
    operationPrefix: "start-session-warm-session",
    repoPath: startedCtx.repoPath,
    sessionId: startedCtx.summary.sessionId,
    taskId: startedCtx.taskId,
    role: startedCtx.role,
    runtimeKind,
    runtimeConnection,
    externalSessionId: startedCtx.summary.externalSessionId,
    loadSessionTodos: model.loadSessionTodos,
    loadSessionModelCatalog: model.loadSessionModelCatalog,
  });
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

      warmStartedSession({
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
