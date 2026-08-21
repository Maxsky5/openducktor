import { workflowAgentSessionScope } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RuntimeInfo } from "../runtime/runtime";
import { readFreshSessionRuntimeKind } from "../support/session-runtime-kind";
import type { PreparedSessionLaunch } from "./prepared-session-launch";
import type { PreparedSessionLaunchCommitInput } from "./session-launch-executor";
import type {
  StartAgentSessionInput,
  StartSessionContext,
  StartSessionExecutionDependencies,
  StartedSessionContext,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { acquireTaskSessionStartupLease } from "./task-session-startup-lease";
import { persistInitialSession } from "./start-session-local-state";
import {
  rollbackBootstrapAfterStartFailure,
  rollbackRegisteredStartedSession,
  rollbackStartedSessionAfterPersistenceFailure,
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

  const runtime = await deps.runtime.ensureRuntime(ctx.repoPath, ctx.taskId, ctx.role, {
    workspaceId: ctx.workspaceId,
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    runtimeKind: selectedModelRuntimeKind,
  });
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

const readForkSourceRuntime = (
  sourceSession: AgentSessionState,
): {
  runtimeKind: AgentSessionState["runtimeKind"];
  workingDirectory: string;
} => {
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

export const commitWorkflowSessionLaunch = async ({
  bootstrap,
  ctx,
  summary,
  identity,
  sessionState,
  isStaleOperation,
  deps,
}: PreparedSessionLaunchCommitInput & {
  bootstrap: RuntimeInfo["bootstrap"];
  ctx: StartSessionContext;
  deps: Pick<StartSessionExecutionDependencies, "session" | "runtime">;
}): Promise<void> => {
  const startedCtx: StartedSessionContext = { ...ctx, summary };

  try {
    await persistInitialSession({
      initialSession: sessionState,
      session: deps.session,
      tags: {
        repoPath: startedCtx.repoPath,
        taskId: startedCtx.taskId,
        role: startedCtx.role,
        externalSessionId: startedCtx.summary.externalSessionId,
      },
    });
  } catch (error) {
    await rollbackStartedSessionAfterPersistenceFailure({
      error,
      startedCtx,
      session: deps.session,
      runtime: deps.runtime,
      ...(bootstrap ? { bootstrap } : {}),
    });
  }

  let bootstrapCompletionAttempted = false;
  let bootstrapCompleted = false;
  try {
    if (isStaleOperation()) {
      throw new Error(STALE_START_ERROR);
    }
    bootstrapCompletionAttempted = !!bootstrap;
    await bootstrap?.complete();
    bootstrapCompleted = !!bootstrap;
    if (isStaleOperation()) {
      throw new Error(STALE_START_ERROR);
    }
  } catch (cause) {
    await rollbackRegisteredStartedSession({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
      startedCtx,
      identity,
      session: deps.session,
      runtime: deps.runtime,
      stopReason: "start-session-stop-after-bootstrap-failure",
      ...(bootstrap && !bootstrapCompleted
        ? {
            bootstrap,
            commitBootstrapOnDeleteFailure: !bootstrapCompletionAttempted,
          }
        : {}),
    });
  }
};
