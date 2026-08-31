import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RuntimeInfo } from "../runtime/runtime";
import { runOrchestratorTask } from "../support/async-side-effects";
import { SessionLaunchStopError } from "./session-launch-errors";
import type {
  RuntimeDependencies,
  SessionDependencies,
  SessionStartTags,
  StartedSessionContext,
} from "./start-session.types";

const toStartedSessionIdentity = (startedCtx: StartedSessionContext): AgentSessionIdentity => ({
  externalSessionId: startedCtx.summary.externalSessionId,
  runtimeKind: startedCtx.summary.runtimeKind,
  workingDirectory: startedCtx.summary.workingDirectory,
});

const toStartedSessionTags = (startedCtx: StartedSessionContext): SessionStartTags => ({
  repoPath: startedCtx.repoPath,
  taskId: startedCtx.taskId,
  role: startedCtx.role,
  externalSessionId: startedCtx.summary.externalSessionId,
});

class BootstrapFinalizationHandledError extends Error {}

type SessionBootstrap = NonNullable<RuntimeInfo["bootstrap"]>;

const describeRollbackStep = (
  failed: boolean,
  cause: unknown,
  failurePrefix: string,
  successMessage: string,
): string => {
  if (failed) {
    return `${failurePrefix}: ${errorMessage(cause)}.`;
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
  if (
    cause instanceof SessionLaunchStopError ||
    cause instanceof BootstrapFinalizationHandledError
  ) {
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

export const rollbackStartedSessionAfterPersistenceFailure = async ({
  error,
  startedCtx,
  session,
  runtime,
  bootstrap,
}: {
  error: unknown;
  startedCtx: StartedSessionContext;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
  bootstrap?: SessionBootstrap;
}): Promise<never> => {
  const externalSessionId = startedCtx.summary.externalSessionId;
  const input: Parameters<typeof rollbackWorkflowSessionRegistration>[0] = {
    message: `Failed to persist started session "${externalSessionId}": ${errorMessage(error)}.`,
    cause: error,
    startedCtx,
    identity: toStartedSessionIdentity(startedCtx),
    session,
    runtime,
    stopReason: "start-session-stop-after-persist-failure",
  };
  if (bootstrap) {
    input.bootstrap = bootstrap;
  }
  return rollbackWorkflowSessionRegistration(input);
};

export const rollbackWorkflowSessionRegistration = async ({
  message,
  cause,
  startedCtx,
  identity,
  session,
  runtime,
  stopReason,
  bootstrap,
  commitBootstrapOnDeleteFailure = true,
  durableRecordExists = true,
}: {
  message: string;
  cause: unknown;
  startedCtx: StartedSessionContext;
  identity: AgentSessionIdentity;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
  stopReason: string;
  bootstrap?: SessionBootstrap;
  commitBootstrapOnDeleteFailure?: boolean;
  durableRecordExists?: boolean;
}): Promise<never> => {
  try {
    await runOrchestratorTask(
      stopReason,
      async () => runtime.adapter.stopSession({ ...identity, repoPath: startedCtx.repoPath }),
      { tags: toStartedSessionTags(startedCtx) },
    );
  } catch (stopError) {
    throw new SessionLaunchStopError(
      `${message} Failed to stop the started session during rollback: ${errorMessage(stopError)}. Cleanup was not continued.`,
      { cause: stopError },
    );
  }

  if (durableRecordExists) {
    try {
      await session.deleteSessionRecord(startedCtx.taskId, identity);
    } catch (error) {
      session.clearSessionObservationState(identity);
      let preserveFailed = false;
      let preserveError: unknown;
      if (bootstrap && commitBootstrapOnDeleteFailure) {
        try {
          await bootstrap.complete();
        } catch (completionError) {
          preserveFailed = true;
          preserveError = completionError;
        }
      }

      const progress = [
        "The started session was stopped.",
        `Failed to delete the durable session record: ${errorMessage(error)}.`,
        "The stopped session remains durably recorded for recovery.",
      ];
      if (bootstrap) {
        if (commitBootstrapOnDeleteFailure) {
          progress.push(
            describeRollbackStep(
              preserveFailed,
              preserveError,
              "Failed to commit the task worktree bootstrap while preserving its resources",
              "The task worktree bootstrap was committed to preserve its resources.",
            ),
          );
        } else {
          progress.push(
            "The task worktree resources were left intact without retrying bootstrap completion.",
          );
        }
      }

      const rollbackMessage = `${message} ${progress.join(" ")}`;
      if (bootstrap) {
        throw new BootstrapFinalizationHandledError(
          rollbackMessage,
          cause instanceof Error ? { cause } : undefined,
        );
      }
      throw new Error(rollbackMessage, cause instanceof Error ? { cause } : undefined);
    }
  }

  session.clearSessionObservationState(identity);
  session.removeSession(identity);

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

  const progress = ["The started session was stopped and its local state was cleared."];
  if (durableRecordExists) {
    progress.push("The durable session record was deleted.");
  }
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

  const rollbackMessage = `${message} ${progress.join(" ")}`;
  if (bootstrap) {
    throw new BootstrapFinalizationHandledError(
      rollbackMessage,
      cause instanceof Error ? { cause } : undefined,
    );
  }
  throw new Error(rollbackMessage, cause instanceof Error ? { cause } : undefined);
};
