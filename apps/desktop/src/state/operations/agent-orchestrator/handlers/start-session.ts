import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentScenario, AgentSessionStartMode } from "@openducktor/core";
import {
  assertAgentKickoffScenario,
  defaultAgentScenarioForRole,
  defaultStartModeForScenario,
  getAgentScenarioDefinition,
  isScenarioStartModeAllowed,
} from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import { appQueryClient } from "@/lib/query-client";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import { agentSessionListQueryOptions } from "@/state/queries/agent-sessions";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireActiveRepo } from "../../tasks/task-operations-model";
import { type RuntimeInfo, resolveRuntimeConnection } from "../runtime/runtime";
import { runOrchestratorSideEffect, runOrchestratorTask } from "../support/async-side-effects";
import { createRepoStaleGuard, normalizeWorkingDirectory, throwIfRepoStale } from "../support/core";
import { normalizePersistedSelection } from "../support/models";
import { inferScenario, kickoffPromptWithTaskContext } from "../support/scenario";
import {
  buildSessionPreludeMessages,
  createSessionPromptContext,
  loadSessionPromptInputs,
} from "../support/session-prompt";
import type {
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
  try {
    await runOrchestratorTask(reason, async () => runtime.adapter.stopSession(tags.sessionId), {
      tags,
    });
  } catch (error) {
    throw new Error(
      `${STALE_START_ERROR} Failed to stop stale started session '${tags.sessionId}': ${errorMessage(error)}`,
      { cause: error },
    );
  }
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

const assertScenarioStartPolicy = ({
  role,
  scenario,
  startMode,
}: {
  role: StartSessionContext["role"];
  scenario: AgentScenario;
  startMode: AgentSessionStartMode;
}): void => {
  const definition = getAgentScenarioDefinition(scenario);
  if (definition.role !== role) {
    throw new Error(
      `Scenario "${scenario}" belongs to role "${definition.role}", but start was requested for role "${role}".`,
    );
  }
  if (!isScenarioStartModeAllowed(scenario, startMode)) {
    throw new Error(`Scenario "${scenario}" does not allow start mode "${startMode}".`);
  }
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
      resolvedDefaultModelSelection = await deps.model.loadRepoDefaultModel(ctx.repoPath, ctx.role);
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

const resolveReuseValidationError = ({
  canReuseSession,
  matchesQaTarget,
  matchesBuildTarget,
}: {
  canReuseSession: boolean;
  matchesQaTarget: boolean;
  matchesBuildTarget: boolean;
}): string | null => {
  if (!canReuseSession) {
    return "its runtime or model selection does not match the requested configuration";
  }
  if (!matchesQaTarget) {
    return "it does not match the required builder worktree for this QA session";
  }
  if (!matchesBuildTarget) {
    return "it does not match the current builder continuation target";
  }
  return null;
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
  const explicitReuseSessionId = input.reuseSessionId?.trim() || null;
  let resolvedQaWorkingDirectory: string | null = null;
  let resolvedBuildWorkingDirectory: string | null = null;
  const resolveExpectedQaWorkingDirectory = async (): Promise<string> => {
    if (resolvedQaWorkingDirectory !== null) {
      return resolvedQaWorkingDirectory;
    }

    const overrideWorkingDirectory = normalizeWorkingDirectory(
      input.builderContext?.workingDirectory,
    );
    resolvedQaWorkingDirectory =
      overrideWorkingDirectory ||
      (await deps.runtime.resolveBuildContinuationTarget(ctx.repoPath, ctx.taskId));
    return resolvedQaWorkingDirectory;
  };
  const resolveExpectedBuildWorkingDirectory = async (): Promise<string> => {
    if (resolvedBuildWorkingDirectory !== null) {
      return resolvedBuildWorkingDirectory;
    }

    const overrideWorkingDirectory = normalizeWorkingDirectory(input.workingDirectoryOverride);
    resolvedBuildWorkingDirectory =
      overrideWorkingDirectory ||
      (await deps.runtime.resolveBuildContinuationTarget(ctx.repoPath, ctx.taskId));
    return resolvedBuildWorkingDirectory;
  };
  const existingSessionMatchesExpectedBuildTarget = async (
    workingDirectory: string,
  ): Promise<boolean> => {
    if (ctx.role !== "build") {
      return true;
    }
    try {
      return (
        normalizeWorkingDirectory(workingDirectory) ===
        (await resolveExpectedBuildWorkingDirectory())
      );
    } catch {
      return false;
    }
  };

  if (input.startMode === "reuse") {
    const existingSessionsForRole = Object.values(deps.session.sessionsRef.current).filter(
      (entry) => entry.taskId === ctx.taskId && entry.role === ctx.role,
    );
    const existingSession = explicitReuseSessionId
      ? existingSessionsForRole.find((entry) => entry.sessionId === explicitReuseSessionId)
      : pickLatestSession(existingSessionsForRole);
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
      const existingSessionMatchesBuildTarget =
        canReuseExistingSession &&
        (await existingSessionMatchesExpectedBuildTarget(existingSession.workingDirectory));
      const existingSessionReuseError = resolveReuseValidationError({
        canReuseSession: canReuseExistingSession,
        matchesQaTarget: existingSessionMatchesQaTarget,
        matchesBuildTarget: existingSessionMatchesBuildTarget,
      });
      if (
        canReuseExistingSession &&
        existingSessionMatchesQaTarget &&
        existingSessionMatchesBuildTarget
      ) {
        if (input.scenario) {
          assertScenarioStartPolicy({
            role: ctx.role,
            scenario: input.scenario,
            startMode: input.startMode,
          });
        }
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
      if (explicitReuseSessionId && existingSessionReuseError) {
        throw new Error(
          `Session "${explicitReuseSessionId}" cannot be reused because ${existingSessionReuseError}.`,
        );
      }
    }

    const persistedSessions = await appQueryClient.fetchQuery({
      ...agentSessionListQueryOptions(ctx.repoPath, ctx.taskId),
    });
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
    const persistedSessionsForRole = persistedSessions.filter((entry) => entry.role === ctx.role);
    const persistedSession = explicitReuseSessionId
      ? persistedSessionsForRole.find((entry) => entry.sessionId === explicitReuseSessionId)
      : pickLatestSession(persistedSessionsForRole);
    const canReusePersistedSession = persistedSession
      ? canReuseSessionForSelectedModel({
          sessionRuntimeKind:
            persistedSession.runtimeKind ??
            persistedSession.selectedModel?.runtimeKind ??
            DEFAULT_RUNTIME_KIND,
          sessionSelectedModel: normalizePersistedSelection(persistedSession.selectedModel),
          selectedModel: input.selectedModel,
        })
      : false;
    const persistedSessionMatchesQaTarget =
      ctx.role !== "qa" ||
      (persistedSession !== undefined &&
        canReusePersistedSession &&
        normalizeWorkingDirectory(persistedSession.workingDirectory) ===
          (await resolveExpectedQaWorkingDirectory()));
    const persistedSessionMatchesBuildTarget =
      persistedSession !== undefined &&
      canReusePersistedSession &&
      (await existingSessionMatchesExpectedBuildTarget(persistedSession.workingDirectory));
    const persistedSessionReuseError =
      persistedSession == null
        ? null
        : resolveReuseValidationError({
            canReuseSession: canReusePersistedSession,
            matchesQaTarget: persistedSessionMatchesQaTarget,
            matchesBuildTarget: persistedSessionMatchesBuildTarget,
          });
    if (
      persistedSession &&
      canReusePersistedSession &&
      persistedSessionMatchesQaTarget &&
      persistedSessionMatchesBuildTarget
    ) {
      if (input.scenario) {
        assertScenarioStartPolicy({
          role: ctx.role,
          scenario: input.scenario,
          startMode: input.startMode,
        });
      }
      if (!deps.session.sessionsRef.current[persistedSession.sessionId]) {
        await deps.session.loadAgentSessions(ctx.taskId, {
          mode: "requested_history",
          targetSessionId: persistedSession.sessionId,
          historyPolicy: "requested_only",
        });
        throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
      }
      if (!deps.session.sessionsRef.current[persistedSession.sessionId]) {
        throw new Error(`Failed to hydrate session "${persistedSession.sessionId}" for reuse.`);
      }
      applySelectedModelToReusedSession({
        repoPath: ctx.repoPath,
        sessionId: persistedSession.sessionId,
        selectedModel: input.selectedModel,
        session: deps.session,
      });
      return {
        kind: "reused",
        sessionId: persistedSession.sessionId,
      };
    }

    if (explicitReuseSessionId) {
      if (!persistedSession) {
        throw new Error(
          `Session "${explicitReuseSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
        );
      }
      throw new Error(
        `Session "${explicitReuseSessionId}" cannot be reused because ${persistedSessionReuseError ?? "it is not reusable for this start request"}.`,
      );
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
  assertScenarioStartPolicy({
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    startMode: input.startMode,
  });
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
  resolvedDefaultModelSelection,
  loadDefaultModelSelection,
  startedCtx,
  session,
}: {
  selectedModel: AgentModelSelection | null;
  requireModelReady: boolean;
  resolvedDefaultModelSelection: AgentModelSelection | null;
  loadDefaultModelSelection: () => Promise<AgentModelSelection | null>;
  startedCtx: StartedSessionContext;
  session: SessionDependencies;
}): Promise<void> => {
  if (selectedModel) {
    return;
  }

  const tags = createSessionStartTags(startedCtx);

  if (requireModelReady) {
    throwIfRepoStale(startedCtx.isStaleRepoOperation, STALE_START_ERROR);
    applyResolvedModelSelection({
      resolvedModel: resolvedDefaultModelSelection,
      startedCtx,
      session,
    });
    return;
  }

  runOrchestratorSideEffect(
    "start-session-apply-default-model-selection",
    loadDefaultModelSelection().then((defaultModelSelection) => {
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
    startMode,
    reuseSessionId = null,
    requireModelReady = false,
    workingDirectoryOverride = null,
    builderContext = null,
  }: StartAgentSessionInput): Promise<string> => {
    const effectiveScenario = scenario ?? defaultAgentScenarioForRole(role);
    const effectiveStartMode = startMode ?? defaultStartModeForScenario(effectiveScenario);
    const repoPath = requireActiveRepo(repo.activeRepo);
    const normalizedWorkingDirectoryOverride = workingDirectoryOverride?.trim() ?? "";
    const normalizedBuilderWorkingDirectory = builderContext?.workingDirectory?.trim() ?? "";
    const normalizedReuseSessionId = reuseSessionId?.trim() ?? "";
    const inFlightKey = `${repoPath}::${taskId}::${role}::${effectiveStartMode}::${normalizedReuseSessionId}::${normalizedWorkingDirectoryOverride}::${normalizedBuilderWorkingDirectory}`;
    const existingInFlight = session.inFlightStartsByRepoTaskRef.current.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const startPromise = Promise.resolve().then(async (): Promise<string> => {
      const isStaleRepoOperation = createRepoStaleGuard({
        repoPath,
        repoEpochRef: repo.repoEpochRef,
        activeRepoRef: repo.activeRepoRef,
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
          scenario: effectiveScenario,
          selectedModel,
          startMode: effectiveStartMode,
          reuseSessionId,
          requireModelReady,
          workingDirectoryOverride,
          builderContext,
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

      await maybeApplyDefaultModelSelection({
        selectedModel,
        requireModelReady,
        resolvedDefaultModelSelection: startResult.resolvedDefaultModelSelection,
        loadDefaultModelSelection: () =>
          model.loadRepoDefaultModel(startResult.ctx.repoPath, startResult.ctx.role),
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
    });

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
