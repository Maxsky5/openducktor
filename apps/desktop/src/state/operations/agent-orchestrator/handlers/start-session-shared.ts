import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentScenario, AgentSessionStartMode } from "@openducktor/core";
import { getAgentScenarioDefinition, isScenarioStartModeAllowed } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import { isRoleAvailableForTask, unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorTask } from "../support/async-side-effects";
import { normalizeWorkingDirectory, throwIfRepoStale } from "../support/core";
import { toPersistedSessionRecord } from "../support/persistence";
import { inferScenario } from "../support/scenario";
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
  StartedSessionContext,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
  TaskDependencies,
} from "./start-session.types";
import { createSessionStartTags } from "./start-session-support";

const STALE_START_ERROR = "Workspace changed while starting session.";

export const MISSING_BUILD_TARGET_ERROR =
  "Builder continuation cannot start until a builder worktree exists";

export const stopSessionOnStaleAndThrow = async ({
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

export const resolveStartTask = ({
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

export const assertScenarioStartPolicy = ({
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

export const resolveRuntimeAndModel = async ({
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

export const buildInitialSession = ({
  startedCtx,
  selectedModel,
  runtime,
  systemPrompt,
  promptOverrides,
}: {
  startedCtx: StartedSessionContext;
  selectedModel: AgentModelSelection;
  runtime: ResolvedRuntimeAndModel["runtime"];
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

export const persistInitialSession = async ({
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

export const rollbackStartedSessionAfterPersistenceFailure = async ({
  error,
  startedCtx,
  session,
  runtime,
}: {
  error: unknown;
  startedCtx: StartedSessionContext;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
}): Promise<never> => {
  const sessionId = startedCtx.summary.sessionId;
  session.setSessionsById((current) => {
    if (!(sessionId in current)) {
      return current;
    }
    const next = { ...current };
    delete next[sessionId];
    return next;
  });

  try {
    await runOrchestratorTask(
      "start-session-stop-after-persist-failure",
      async () => runtime.adapter.stopSession(sessionId),
      { tags: createSessionStartTags(startedCtx) },
    );
  } catch (stopError) {
    throw new Error(
      `Failed to persist started session "${sessionId}": ${errorMessage(error)}. Failed to stop the started session during rollback: ${errorMessage(stopError)}`,
      { cause: stopError },
    );
  }

  throw new Error(
    `Failed to persist started session "${sessionId}": ${errorMessage(error)}. The started session was stopped and removed locally.`,
    error instanceof Error ? { cause: error } : undefined,
  );
};

export const registerStartedSession = async ({
  ctx,
  startedCtx,
  runtimeInfo,
  systemPrompt,
  promptOverrides,
  selectedModel,
  deps,
  taskCard,
}: {
  ctx: StartSessionContext;
  startedCtx: StartedSessionContext;
  runtimeInfo: ResolvedRuntimeAndModel["runtime"];
  systemPrompt: string;
  promptOverrides: ResolvedRuntimeAndModel["promptOverrides"];
  selectedModel: AgentModelSelection;
  deps: Pick<StartSessionExecutionDependencies, "session" | "runtime">;
  taskCard: TaskCard;
}): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const initialSession = buildInitialSession({
    startedCtx,
    selectedModel,
    runtime: runtimeInfo,
    systemPrompt,
    promptOverrides,
  });

  deps.session.setSessionsById((current) => {
    if (ctx.isStaleRepoOperation()) {
      return current;
    }
    return {
      ...current,
      [startedCtx.summary.sessionId]: initialSession,
    };
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  try {
    await persistInitialSession({
      initialSession,
      session: deps.session,
      tags: createSessionStartTags(startedCtx),
    });
  } catch (error) {
    await rollbackStartedSessionAfterPersistenceFailure({
      error,
      startedCtx,
      session: deps.session,
      runtime: deps.runtime,
    });
  }

  return {
    kind: "started",
    runtimeInfo,
    taskCard,
    ctx: startedCtx,
    promptOverrides,
  };
};

export const resolveReuseValidationError = ({
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

export const resolveFreshStartTargetWorkingDirectory = async ({
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

export const resolveFreshStartTargetWorkingDirectoryForStart = async ({
  ctx,
  runtime,
  targetWorkingDirectory,
}: {
  ctx: StartSessionContext;
  runtime: RuntimeDependencies;
  targetWorkingDirectory?: string | null;
}): Promise<{
  targetWorkingDirectory: string | null | undefined;
  normalizedTargetWorkingDirectory: string;
}> => {
  if (targetWorkingDirectory !== undefined) {
    return {
      targetWorkingDirectory,
      normalizedTargetWorkingDirectory: normalizeWorkingDirectory(targetWorkingDirectory),
    };
  }

  const targetWorkingDirectoryForStart = await resolveFreshStartTargetWorkingDirectory({
    ctx,
    runtime,
  });
  return {
    targetWorkingDirectory: targetWorkingDirectoryForStart,
    normalizedTargetWorkingDirectory: normalizeWorkingDirectory(targetWorkingDirectoryForStart),
  };
};

export const serializeSelectedModelKey = (
  selectedModel: AgentModelSelection | undefined,
): string => {
  if (!selectedModel) {
    return "";
  }
  return [
    selectedModel.runtimeKind ?? "",
    selectedModel.providerId,
    selectedModel.modelId,
    selectedModel.variant ?? "",
    selectedModel.profileId ?? "",
  ].join("::");
};
