import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentScenario, AgentSessionStartMode } from "@openducktor/core";
import {
  assertAgentKickoffScenario,
  defaultAgentScenarioForRole,
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
import { toPersistedSessionRecord } from "../support/persistence";
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
import { createSessionStartTags } from "./start-session-support";

export type { StartAgentSessionInput, StartSessionDependencies } from "./start-session.types";

const MISSING_BUILD_TARGET_ERROR =
  "Builder continuation cannot start until a builder worktree exists";
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
  targetWorkingDirectory,
  requestedRuntimeKind,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  scenario: AgentScenario | undefined;
  targetWorkingDirectory?: string | null;
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
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    ...(requestedRuntimeKind ? { runtimeKind: requestedRuntimeKind } : {}),
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

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
  selectedModel: AgentModelSelection;
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
  status: "starting",
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

const persistInitialSession = async ({
  initialSession,
  session,
  tags,
}: {
  initialSession: AgentSessionState;
  session: SessionDependencies;
  tags: SessionStartTags;
}): Promise<void> => {
  await runOrchestratorTask(
    "start-session-persist-initial-session",
    async () => {
      await session.persistSessionRecord(
        initialSession.taskId,
        toPersistedSessionRecord(initialSession),
      );
    },
    { tags },
  );
};

const resolveReuseValidationError = ({
  matchesQaTarget,
  matchesBuildTarget,
}: {
  matchesQaTarget: boolean;
  matchesBuildTarget: boolean;
}): string | null => {
  if (!matchesQaTarget) {
    return "it does not match the required builder worktree for this QA session";
  }
  if (!matchesBuildTarget) {
    return "it does not match the current builder continuation target";
  }
  return null;
};

const resolveFreshStartTargetWorkingDirectory = async ({
  ctx,
  runtime,
}: {
  ctx: StartSessionContext;
  runtime: RuntimeDependencies;
}): Promise<string | null | undefined> => {
  if (ctx.role === "qa") {
    return runtime.resolveBuildContinuationTarget(ctx.repoPath, ctx.taskId);
  }

  if (ctx.role !== "build") {
    return undefined;
  }

  try {
    return await runtime.resolveBuildContinuationTarget(ctx.repoPath, ctx.taskId);
  } catch (error) {
    if (errorMessage(error).includes(MISSING_BUILD_TARGET_ERROR)) {
      return null;
    }
    throw error;
  }
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
  let resolvedBuildWorkingDirectory: string | null = null;
  const resolveExpectedQaWorkingDirectory = async (): Promise<string> => {
    if (resolvedQaWorkingDirectory !== null) {
      return resolvedQaWorkingDirectory;
    }

    resolvedQaWorkingDirectory = await deps.runtime.resolveBuildContinuationTarget(
      ctx.repoPath,
      ctx.taskId,
    );
    return resolvedQaWorkingDirectory;
  };
  const resolveExpectedBuildWorkingDirectory = async (): Promise<string> => {
    if (resolvedBuildWorkingDirectory !== null) {
      return resolvedBuildWorkingDirectory;
    }

    resolvedBuildWorkingDirectory = await deps.runtime.resolveBuildContinuationTarget(
      ctx.repoPath,
      ctx.taskId,
    );
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

  const resolveLoadedSourceSession = async (sourceSessionId: string): Promise<AgentSessionState> => {
    const existingSessionsForRole = Object.values(deps.session.sessionsRef.current).filter(
      (entry) => entry.taskId === ctx.taskId && entry.role === ctx.role,
    );
    const existingSourceSession = existingSessionsForRole.find(
      (entry) => entry.sessionId === sourceSessionId,
    );
    if (existingSourceSession) {
      return existingSourceSession;
    }

    const persistedSessions = await appQueryClient.fetchQuery({
      ...agentSessionListQueryOptions(ctx.repoPath, ctx.taskId),
    });
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
    const persistedSessionsForRole = persistedSessions.filter((entry) => entry.role === ctx.role);
    const persistedSourceSession = persistedSessionsForRole.find(
      (entry) => entry.sessionId === sourceSessionId,
    );
    if (!persistedSourceSession) {
      throw new Error(
        `Session "${sourceSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
      );
    }
    if (!deps.session.sessionsRef.current[persistedSourceSession.sessionId]) {
      await deps.session.loadAgentSessions(ctx.taskId, {
        mode: "requested_history",
        targetSessionId: persistedSourceSession.sessionId,
        historyPolicy: "requested_only",
      });
      throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
    }
    const hydratedSession = deps.session.sessionsRef.current[persistedSourceSession.sessionId];
    if (!hydratedSession) {
      throw new Error(
        `Failed to hydrate session "${persistedSourceSession.sessionId}" for forking.`,
      );
    }
    return hydratedSession;
  };

  if (input.startMode === "reuse") {
    const existingSessionsForRole = Object.values(deps.session.sessionsRef.current).filter(
      (entry) => entry.taskId === ctx.taskId && entry.role === ctx.role,
    );
    const existingSession = existingSessionsForRole.find(
      (entry) => entry.sessionId === input.sourceSessionId,
    );
    if (existingSession) {
      const existingSessionMatchesQaTarget =
        ctx.role !== "qa" ||
        normalizeWorkingDirectory(existingSession.workingDirectory) ===
          (await resolveExpectedQaWorkingDirectory());
      const existingSessionMatchesBuildTarget = await existingSessionMatchesExpectedBuildTarget(
        existingSession.workingDirectory,
      );
      const existingSessionReuseError = resolveReuseValidationError({
        matchesQaTarget: existingSessionMatchesQaTarget,
        matchesBuildTarget: existingSessionMatchesBuildTarget,
      });
      if (existingSessionMatchesQaTarget && existingSessionMatchesBuildTarget) {
        if (input.scenario) {
          assertScenarioStartPolicy({
            role: ctx.role,
            scenario: input.scenario,
            startMode: input.startMode,
          });
        }
        return {
          kind: "reused",
          sessionId: existingSession.sessionId,
        };
      }
      if (existingSessionReuseError) {
        throw new Error(
          `Session "${input.sourceSessionId}" cannot be reused because ${existingSessionReuseError}.`,
        );
      }
    }

    const persistedSessions = await appQueryClient.fetchQuery({
      ...agentSessionListQueryOptions(ctx.repoPath, ctx.taskId),
    });
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
    const persistedSessionsForRole = persistedSessions.filter((entry) => entry.role === ctx.role);
    const persistedSession = persistedSessionsForRole.find(
      (entry) => entry.sessionId === input.sourceSessionId,
    );
    const persistedSessionMatchesQaTarget =
      ctx.role !== "qa" ||
      (persistedSession !== undefined &&
        normalizeWorkingDirectory(persistedSession.workingDirectory) ===
          (await resolveExpectedQaWorkingDirectory()));
    const persistedSessionMatchesBuildTarget =
      persistedSession !== undefined &&
      (await existingSessionMatchesExpectedBuildTarget(persistedSession.workingDirectory));
    const persistedSessionReuseError =
      persistedSession == null
        ? null
        : resolveReuseValidationError({
            matchesQaTarget: persistedSessionMatchesQaTarget,
            matchesBuildTarget: persistedSessionMatchesBuildTarget,
          });
    if (persistedSession && persistedSessionMatchesQaTarget && persistedSessionMatchesBuildTarget) {
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
      return {
        kind: "reused",
        sessionId: persistedSession.sessionId,
      };
    }

    if (!persistedSession) {
      throw new Error(
        `Session "${input.sourceSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
      );
    }
    throw new Error(
      `Session "${input.sourceSessionId}" cannot be reused because ${persistedSessionReuseError ?? "it is not reusable for this start request"}.`,
    );
  }

  if (input.startMode === "fork") {
    const sourceSession = await resolveLoadedSourceSession(input.sourceSessionId);
    const taskCard = validatedTaskCard ?? resolveStartTask({ ctx, task: deps.task });
    const resolved = await resolveRuntimeAndModel({
      ctx,
      scenario: input.scenario,
      requestedRuntimeKind: input.selectedModel.runtimeKind,
      targetWorkingDirectory: sourceSession.workingDirectory,
      taskCard,
      deps,
    });
    const selectedModel = input.selectedModel;
    assertScenarioStartPolicy({
      role: ctx.role,
      scenario: resolved.resolvedScenario,
      startMode: input.startMode,
    });

    const summary = await deps.runtime.adapter.forkSession({
      repoPath: ctx.repoPath,
      runtimeKind:
        sourceSession.runtimeKind ??
        resolved.runtime.runtimeKind ??
        selectedModel?.runtimeKind ??
        DEFAULT_RUNTIME_KIND,
      runtimeConnection: {
        endpoint: sourceSession.runtimeEndpoint || resolved.runtime.runtimeEndpoint,
        workingDirectory: sourceSession.workingDirectory,
      },
      workingDirectory: sourceSession.workingDirectory,
      taskId: ctx.taskId,
      role: ctx.role,
      scenario: resolved.resolvedScenario,
      systemPrompt: resolved.systemPrompt,
      ...(sourceSession.runtimeId ? { runtimeId: sourceSession.runtimeId } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
      parentExternalSessionId: sourceSession.externalSessionId,
    });

    const startedCtx: StartedSessionContext = {
      ...ctx,
      resolvedScenario: resolved.resolvedScenario,
      summary,
    };

    if (ctx.isStaleRepoOperation()) {
      await stopSessionOnStaleAndThrow({
        reason: "start-session-stop-on-stale-after-fork",
        runtime: deps.runtime,
        startedCtx,
      });
    }

    const forkedRuntime: RuntimeInfo = {
      runtimeKind:
        sourceSession.runtimeKind ??
        resolved.runtime.runtimeKind ??
        selectedModel?.runtimeKind ??
        DEFAULT_RUNTIME_KIND,
      runtimeId: sourceSession.runtimeId ?? resolved.runtime.runtimeId,
      runId: sourceSession.runId ?? resolved.runtime.runId,
      runtimeEndpoint: sourceSession.runtimeEndpoint || resolved.runtime.runtimeEndpoint,
      workingDirectory: sourceSession.workingDirectory,
      ...(resolved.runtime.kind ? { kind: resolved.runtime.kind } : {}),
    };

    const initialSession = buildInitialSession({
      startedCtx,
      selectedModel,
      runtime: forkedRuntime,
      systemPrompt: resolved.systemPrompt,
      promptOverrides: resolved.promptOverrides,
    });

    deps.session.setSessionsById((current) => {
      if (ctx.isStaleRepoOperation()) {
        return current;
      }
      return {
        ...current,
        [summary.sessionId]: initialSession,
      };
    });
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

    await persistInitialSession({
      initialSession,
      session: deps.session,
      tags: createSessionStartTags(startedCtx),
    });

    return {
      kind: "started",
      runtimeInfo: forkedRuntime,
      taskCard: resolved.taskCard,
      ctx: startedCtx,
      promptOverrides: resolved.promptOverrides,
    };
  }

  const taskCard = validatedTaskCard ?? resolveStartTask({ ctx, task: deps.task });
  const selectedModel = input.selectedModel;
  const targetWorkingDirectory = await resolveFreshStartTargetWorkingDirectory({
    ctx,
    runtime: deps.runtime,
  });
  const resolved = await resolveRuntimeAndModel({
    ctx,
    scenario: input.scenario,
    requestedRuntimeKind: selectedModel.runtimeKind,
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    taskCard,
    deps,
  });

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
    selectedModel: input.selectedModel,
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

  await persistInitialSession({
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
    session.setSessionsById((current) => {
      const currentSession = current[startedCtx.summary.sessionId];
      if (!currentSession || currentSession.status !== "starting") {
        return current;
      }
      return {
        ...current,
        [startedCtx.summary.sessionId]: {
          ...currentSession,
          status: "idle",
        },
      };
    });
    return;
  }

  await stopSessionOnStaleAndThrow({
    reason: "start-session-stop-on-stale-after-listener-attach",
    runtime,
    startedCtx,
  });
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
  return async (input: StartAgentSessionInput): Promise<string> => {
    const {
      taskId,
      role,
      scenario,
      sendKickoff = false,
      startMode,
    } = input;
    const effectiveScenario = scenario ?? defaultAgentScenarioForRole(role);
    const repoPath = requireActiveRepo(repo.activeRepo);
    const normalizedSourceSessionId =
      input.startMode === "fresh" ? "" : input.sourceSessionId.trim();
    const inFlightKey = `${repoPath}::${taskId}::${role}::${startMode}::${normalizedSourceSessionId}`;
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
          ...input,
          scenario: effectiveScenario,
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
