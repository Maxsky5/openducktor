import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { runOrchestratorTask } from "../support/async-side-effects";
import type {
  RuntimeDependencies,
  SessionDependencies,
  SessionStartTags,
  StartedSessionContext,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";

const toStartedSessionIdentity = (startedCtx: StartedSessionContext): AgentSessionIdentity => ({
  externalSessionId: startedCtx.summary.externalSessionId,
  runtimeKind: startedCtx.summary.runtimeKind,
  workingDirectory: startedCtx.summary.workingDirectory,
});

const toStartedSessionStopTarget = (startedCtx: StartedSessionContext) => {
  return {
    ...toStartedSessionIdentity(startedCtx),
    repoPath: startedCtx.repoPath,
  };
};

const toStartedSessionTags = (startedCtx: StartedSessionContext): SessionStartTags => ({
  repoPath: startedCtx.repoPath,
  taskId: startedCtx.taskId,
  role: startedCtx.role,
  externalSessionId: startedCtx.summary.externalSessionId,
});

class StartedSessionStopError extends Error {}

const describeRollbackStep = (
  failed: boolean,
  error: unknown,
  failurePrefix: string,
  successMessage: string,
): string => {
  if (failed) {
    return `${failurePrefix}: ${errorMessage(error)}.`;
  }
  return successMessage;
};

export const rollbackBootstrapAfterStartFailure = async ({
  cause,
  bootstrap,
}: {
  cause: unknown;
  bootstrap: { abort: () => Promise<void> };
}): Promise<never> => {
  if (cause instanceof StartedSessionStopError) {
    throw cause;
  }
  try {
    await bootstrap.abort();
  } catch (abortCause) {
    throw new Error(
      `${errorMessage(cause)}\nAlso failed to roll back task worktree bootstrap: ${errorMessage(abortCause)}`,
      cause instanceof Error ? { cause } : undefined,
    );
  }
  throw cause;
};

export const stopSessionOnStaleAndThrow = async ({
  reason,
  runtime,
  startedCtx,
}: {
  reason: string;
  runtime: RuntimeDependencies;
  startedCtx: StartedSessionContext;
}): Promise<never> => {
  const tags = toStartedSessionTags(startedCtx);
  try {
    await runOrchestratorTask(
      reason,
      async () => runtime.adapter.stopSession(toStartedSessionStopTarget(startedCtx)),
      {
        tags,
      },
    );
  } catch (error) {
    throw new StartedSessionStopError(
      `${STALE_START_ERROR} Failed to stop stale started session '${tags.externalSessionId}': ${errorMessage(error)}`,
      { cause: error },
    );
  }
  throw new Error(STALE_START_ERROR);
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
  const externalSessionId = startedCtx.summary.externalSessionId;
  return rollbackRegisteredStartedSession({
    message: `Failed to persist started session "${externalSessionId}": ${errorMessage(error)}.`,
    cause: error,
    startedCtx,
    identity: toStartedSessionIdentity(startedCtx),
    session,
    runtime,
    stopReason: "start-session-stop-after-persist-failure",
  });
};

export const rollbackRegisteredStartedSession = async ({
  message,
  cause,
  startedCtx,
  identity,
  session,
  runtime,
  stopReason,
  bootstrap,
}: {
  message: string;
  cause: unknown;
  startedCtx: StartedSessionContext;
  identity: AgentSessionIdentity;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
  stopReason: string;
  bootstrap?: { abort: () => Promise<void> };
}): Promise<never> => {
  try {
    await runOrchestratorTask(
      stopReason,
      async () => runtime.adapter.stopSession({ ...identity, repoPath: startedCtx.repoPath }),
      { tags: toStartedSessionTags(startedCtx) },
    );
  } catch (stopError) {
    throw new StartedSessionStopError(
      `${message} Failed to stop the started session during rollback: ${errorMessage(stopError)}. Cleanup was not continued.`,
      { cause: stopError },
    );
  }

  session.clearSessionObservationState(identity);
  session.removeSession(identity);

  let deleteFailed = false;
  let deleteError: unknown;
  try {
    await session.deleteSessionRecord(startedCtx.taskId, identity);
  } catch (error) {
    deleteFailed = true;
    deleteError = error;
  }

  let abortFailed = false;
  let abortError: unknown;
  if (bootstrap) {
    try {
      await bootstrap.abort();
    } catch (error) {
      abortFailed = true;
      abortError = error;
    }
  }

  const progress = [
    "The started session was stopped and removed locally.",
    describeRollbackStep(
      deleteFailed,
      deleteError,
      "Failed to delete the durable session record",
      "The durable session record was deleted.",
    ),
  ];
  if (bootstrap) {
    progress.push(
      describeRollbackStep(
        abortFailed,
        abortError,
        "Failed to roll back task worktree bootstrap",
        "The task worktree bootstrap was rolled back.",
      ),
    );
  }

  throw new Error(
    `${message} ${progress.join(" ")}`,
    cause instanceof Error ? { cause } : undefined,
  );
};

export const rollbackStartedSessionBeforeRegistration = async ({
  error,
  startedCtx,
  runtime,
  reason,
}: {
  error: unknown;
  startedCtx: StartedSessionContext;
  runtime: RuntimeDependencies;
  reason: string;
}): Promise<never> => {
  const externalSessionId = startedCtx.summary.externalSessionId;

  try {
    await runOrchestratorTask(
      reason,
      async () => runtime.adapter.stopSession(toStartedSessionStopTarget(startedCtx)),
      {
        tags: toStartedSessionTags(startedCtx),
      },
    );
  } catch (stopError) {
    throw new StartedSessionStopError(
      `Failed to initialize started session "${externalSessionId}": ${errorMessage(error)}. Failed to stop the started session during rollback: ${errorMessage(stopError)}`,
      { cause: stopError },
    );
  }

  throw new Error(
    `Failed to initialize started session "${externalSessionId}": ${errorMessage(error)}. The started session was stopped before local registration.`,
    error instanceof Error ? { cause: error } : undefined,
  );
};
