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
    throw new Error(
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
  session.removeSession(identity);

  let stopError: unknown;
  try {
    await runOrchestratorTask(
      stopReason,
      async () => runtime.adapter.stopSession({ ...identity, repoPath: startedCtx.repoPath }),
      { tags: toStartedSessionTags(startedCtx) },
    );
  } catch (error) {
    stopError = error;
  }

  let deleteError: unknown;
  try {
    await session.deleteSessionRecord(startedCtx.taskId, identity);
  } catch (error) {
    deleteError = error;
  }

  let abortError: unknown;
  if (bootstrap) {
    try {
      await bootstrap.abort();
    } catch (error) {
      abortError = error;
    }
  }

  const progress = [
    stopError
      ? `Failed to stop the started session during rollback: ${errorMessage(stopError)}.`
      : "The started session was stopped and removed locally.",
    deleteError
      ? `Failed to delete the durable session record: ${errorMessage(deleteError)}.`
      : "The durable session record was deleted.",
    ...(bootstrap
      ? [
          abortError
            ? `Failed to roll back task worktree bootstrap: ${errorMessage(abortError)}.`
            : "The task worktree bootstrap was rolled back.",
        ]
      : []),
  ].join(" ");

  throw new Error(`${message} ${progress}`, cause instanceof Error ? { cause } : undefined);
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
    throw new Error(
      `Failed to initialize started session "${externalSessionId}": ${errorMessage(error)}. Failed to stop the started session during rollback: ${errorMessage(stopError)}`,
      { cause: stopError },
    );
  }

  throw new Error(
    `Failed to initialize started session "${externalSessionId}": ${errorMessage(error)}. The started session was stopped before local registration.`,
    error instanceof Error ? { cause: error } : undefined,
  );
};
