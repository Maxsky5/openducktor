import { workflowAgentSessionScope } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { EnsureRuntimeOptions, RuntimeInfo } from "../runtime/runtime";
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
import { acquireTaskSessionStartupLease } from "./task-session-startup-lease";
import {
  rollbackBootstrapAfterStartFailure,
  stopStoredWorkflowSessionAfterLaunchFailure,
} from "./start-session-rollback";
import { loadStartSystemPrompt } from "./start-session-runtime";
import { resolveStartTask } from "./start-session-policies";
import { resolveLoadedSourceSession } from "./start-session-reuse-strategy";

export type WorkflowPreparedLaunch = {
  launch: Extract<PreparedSessionLaunch, { mode: "start" | "fork" }>;
  bootstrap: RuntimeInfo["bootstrap"];
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

  const runtimeOptions: EnsureRuntimeOptions = {
    workspaceId: ctx.workspaceId,
    runtimeKind: selectedModelRuntimeKind,
  };
  if (targetWorkingDirectory !== undefined) {
    runtimeOptions.targetWorkingDirectory = targetWorkingDirectory;
  }

  // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- worktree bootstrap is a side effect; a stale repo or failed prompt must throw before it starts
  const runtime = await deps.runtime.ensureRuntime(
    ctx.repoPath,
    ctx.taskId,
    ctx.role,
    runtimeOptions,
  );
  if (ctx.isStaleRepoOperation()) {
    try {
      await runtime.bootstrap?.abort();
    } catch (error) {
      throw new Error(
        `${STALE_START_ERROR} Failed to roll back task worktree bootstrap: ${errorMessage(error)}`,
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    throw new Error(STALE_START_ERROR);
  }

  return {
    launch: {
      mode: "start",
      repoPath: ctx.repoPath,
      runtimeKind: selectedModelRuntimeKind,
      workingDirectory: runtime.workingDirectory,
      sessionAssociation: toWorkflowAssociation(ctx),
      systemPrompt,
      selectedModel: selectedModelWithRuntime,
      holdForPostStartMessage: ctx.holdForPostStartMessage,
    },
    bootstrap: runtime.bootstrap,
  };
};

const readForkSourceRuntime = (sourceSession: AgentSessionState) => {
  const sourceWorkingDirectory = normalizeWorkingDirectory(sourceSession.workingDirectory);
  if (!sourceWorkingDirectory) {
    throw new Error(
      `Session "${sourceSession.externalSessionId}" is missing working directory metadata required for forking.`,
    );
  }

  return { runtimeKind: sourceSession.runtimeKind, workingDirectory: sourceWorkingDirectory };
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
  const lease = await acquireTaskSessionStartupLease({
    repoPath: ctx.repoPath,
    taskId: ctx.taskId,
    role: ctx.role,
    prepare: deps.runtime.prepareTaskSessionStartupLease,
    complete: deps.runtime.completeTaskSessionStartupLease,
    abort: deps.runtime.abortTaskSessionStartupLease,
  });
  try {
    const sourceSession = await resolveLoadedSourceSession({
      ctx,
      deps,
      sourceSession: input.sourceSession,
    });
    const { runtimeKind: sourceRuntimeKind, workingDirectory } =
      readForkSourceRuntime(sourceSession);
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
      bootstrap: lease.bootstrap,
    };
  } catch (cause) {
    return rollbackBootstrapAfterStartFailure({ cause, bootstrap: lease.bootstrap });
  }
};

export const registerWorkflowSessionLaunch = async ({
  bootstrap,
  ctx,
  summary,
  identity,
  sessionState,
  isStaleOperation,
  deps,
}: PreparedSessionRegistrationInput & {
  bootstrap: RuntimeInfo["bootstrap"];
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
    if (bootstrap) {
      cleanupInput.bootstrapToComplete = bootstrap;
    }
    await stopStoredWorkflowSessionAfterLaunchFailure(cleanupInput);
  }

  let bootstrapCompletionAttempted = false;
  try {
    if (isStaleOperation()) {
      throw new Error(STALE_START_ERROR);
    }
    await deps.task.refreshSessionRecords(ctx.repoPath, ctx.taskId);
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
    bootstrapCompletionAttempted = !!bootstrap;
    await bootstrap?.complete();
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
      stopReason: "start-session-stop-after-bootstrap-failure",
    };
    if (bootstrap && !bootstrapCompletionAttempted) {
      cleanupInput.bootstrapToComplete = bootstrap;
    }
    await stopStoredWorkflowSessionAfterLaunchFailure(cleanupInput);
  }
};
