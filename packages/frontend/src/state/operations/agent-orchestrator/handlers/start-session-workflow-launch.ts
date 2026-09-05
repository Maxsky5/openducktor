import { workflowAgentSessionScope } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { readFreshSessionRuntimeKind } from "../support/session-runtime-kind";
import type { PreparedSessionLaunch } from "./prepared-session-launch";
import type { PreparedSessionRegistrationInput } from "./session-launch-executor";
import type {
  StartAgentSessionInput,
  StartSessionContext,
  StartSessionExecutionDependencies,
  StartedSessionContext,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { stopStoredWorkflowSessionAfterLaunchFailure } from "./start-session-rollback";
import { loadStartSystemPrompt } from "./start-session-runtime";
import { resolveStartTask } from "./start-session-policies";
import { resolveLoadedSourceSession } from "./start-session-reuse-strategy";

export type WorkflowPreparedLaunch = {
  launch: Extract<PreparedSessionLaunch, { mode: "workflow_start" | "fork" }>;
};

const toWorkflowAssociation = (ctx: StartSessionContext) =>
  workflowAgentSessionScope(ctx.taskId, ctx.role);

export const prepareWorkflowFreshLaunch = async ({
  ctx,
  input,
  targetWorkingDirectory,
  deps,
}: {
  ctx: StartSessionContext;
  input: Extract<StartAgentSessionInput, { startMode: "fresh" }>;
  targetWorkingDirectory: string | null | undefined;
  deps: StartSessionExecutionDependencies;
}): Promise<WorkflowPreparedLaunch> => {
  const taskCard = resolveStartTask({ ctx, task: deps.task });
  const selectedModel = input.selectedModel;
  const selectedModelRuntimeKind = readFreshSessionRuntimeKind(selectedModel);
  const selectedModelWithRuntime = {
    ...selectedModel,
    runtimeKind: selectedModelRuntimeKind,
  };

  const systemPrompt = await loadStartSystemPrompt({ ctx, taskCard, deps });

  const launch: Extract<PreparedSessionLaunch, { mode: "workflow_start" }> = {
    mode: "workflow_start",
    repoPath: ctx.repoPath,
    runtimeKind: selectedModelRuntimeKind,
    sessionAssociation: toWorkflowAssociation(ctx),
    systemPrompt,
    selectedModel: selectedModelWithRuntime,
    holdForPostStartMessage: ctx.holdForPostStartMessage,
  };
  const target = targetWorkingDirectory?.trim();
  if (target) {
    launch.targetWorkingDirectory = target;
  }
  return { launch };
};

const readForkSourceRuntime = (sourceSession: AgentSessionState) => {
  const sourceWorkingDirectory = normalizeWorkingDirectory(sourceSession.workingDirectory);
  if (!sourceWorkingDirectory) {
    throw new Error(
      `Session "${sourceSession.externalSessionId}" is missing working directory metadata required for forking.`,
    );
  }

  return {
    runtimeKind: sourceSession.runtimeKind,
    workingDirectory: sourceWorkingDirectory,
  };
};

export const prepareWorkflowForkLaunch = async ({
  ctx,
  input,
  deps,
}: {
  ctx: StartSessionContext;
  input: Extract<StartAgentSessionInput, { startMode: "fork" }>;
  deps: StartSessionExecutionDependencies;
}): Promise<WorkflowPreparedLaunch> => {
  const taskCard = resolveStartTask({ ctx, task: deps.task });
  const sourceSession = await resolveLoadedSourceSession({
    ctx,
    deps,
    sourceSession: input.sourceSession,
  });
  const { runtimeKind: sourceRuntimeKind, workingDirectory } = readForkSourceRuntime(sourceSession);
  const [canonicalWorkingDirectory, canonicalRepoPath] = await Promise.all([
    deps.runtime.canonicalizePath(workingDirectory),
    deps.runtime.canonicalizePath(ctx.repoPath),
  ]);
  if (
    normalizeWorkingDirectory(canonicalWorkingDirectory) ===
    normalizeWorkingDirectory(canonicalRepoPath)
  ) {
    throw new Error(
      `Session "${sourceSession.externalSessionId}" is a legacy repository-root task session and cannot be forked. Start a fresh session in the task worktree instead.`,
    );
  }

  const selectedModel = input.selectedModel;
  if (selectedModel.runtimeKind && sourceRuntimeKind !== selectedModel.runtimeKind) {
    throw new Error(
      `Session "${input.sourceSession.externalSessionId}" cannot be forked with runtime "${selectedModel.runtimeKind}" because it belongs to runtime "${sourceRuntimeKind}".`,
    );
  }

  const systemPrompt = await loadStartSystemPrompt({
    ctx,
    taskCard,
    deps,
  });

  return {
    launch: {
      mode: "fork",
      repoPath: ctx.repoPath,
      runtimeKind: sourceRuntimeKind,
      workingDirectory,
      sessionAssociation: toWorkflowAssociation(ctx),
      systemPrompt,
      parentExternalSessionId: sourceSession.externalSessionId,
      selectedModel,
      holdForPostStartMessage: ctx.holdForPostStartMessage,
    },
  };
};

export const registerWorkflowSessionLaunch = async ({
  ctx,
  summary,
  identity,
  sessionState,
  isStaleOperation,
  deps,
}: PreparedSessionRegistrationInput & {
  ctx: StartSessionContext;
  deps: Pick<StartSessionExecutionDependencies, "session" | "runtime" | "task">;
}): Promise<void> => {
  const startedCtx: StartedSessionContext = { ...ctx, summary };

  if (isStaleOperation()) {
    const cause = new Error(STALE_START_ERROR);
    const cleanupInput: Parameters<typeof stopStoredWorkflowSessionAfterLaunchFailure>[0] = {
      message: STALE_START_ERROR,
      cause,
      startedCtx,
      identity,
      readSessionSnapshot: deps.session.readSessionSnapshot,
      replaceSession: deps.session.replaceSession,
      clearSessionObservationState: deps.session.clearSessionObservationState,
      runtime: deps.runtime,
      stopReason: "start-session-stop-on-stale-before-attach",
    };
    await stopStoredWorkflowSessionAfterLaunchFailure(cleanupInput);
  }

  try {
    if (isStaleOperation()) {
      throw new Error(STALE_START_ERROR);
    }
    await deps.task.refreshSessionRecords(ctx.repoPath, ctx.taskId);
    if (isStaleOperation()) {
      throw new Error(STALE_START_ERROR);
    }
    await deps.task.refreshTaskData(ctx.repoPath, ctx.taskId);
    if (isStaleOperation()) {
      throw new Error(STALE_START_ERROR);
    }
    try {
      deps.session.replaceSession(sessionState);
    } catch (cause) {
      throw new Error(
        `Failed to attach stored session "${identity.externalSessionId}" to task "${ctx.taskId}": ${errorMessage(cause)}.`,
        cause instanceof Error ? { cause } : undefined,
      );
    }
    if (isStaleOperation()) {
      throw new Error(STALE_START_ERROR);
    }
  } catch (cause) {
    const cleanupInput: Parameters<typeof stopStoredWorkflowSessionAfterLaunchFailure>[0] = {
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
      startedCtx,
      identity,
      readSessionSnapshot: deps.session.readSessionSnapshot,
      replaceSession: deps.session.replaceSession,
      clearSessionObservationState: deps.session.clearSessionObservationState,
      runtime: deps.runtime,
      stopReason: "start-session-stop-after-registration-failure",
    };
    await stopStoredWorkflowSessionAfterLaunchFailure(cleanupInput);
  }
};
