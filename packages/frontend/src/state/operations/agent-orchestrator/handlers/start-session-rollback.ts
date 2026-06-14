import { errorMessage } from "@/lib/errors";
import { removeAgentSession } from "@/state/agent-session-collection";
import { runOrchestratorTask } from "../support/async-side-effects";
import type {
  RuntimeDependencies,
  SessionDependencies,
  StartedSessionContext,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { createSessionStartTags } from "./start-session-support";

const readStartedSessionRuntimeKind = (startedCtx: StartedSessionContext) => {
  const runtimeKind = startedCtx.summary.runtimeKind;
  if (!runtimeKind) {
    throw new Error(
      `Runtime kind is required to stop started session '${startedCtx.summary.externalSessionId}'.`,
    );
  }
  return runtimeKind;
};

const toStartedSessionStopTarget = (startedCtx: StartedSessionContext) => {
  const runtimeKind = readStartedSessionRuntimeKind(startedCtx);
  return {
    repoPath: startedCtx.repoPath,
    externalSessionId: startedCtx.summary.externalSessionId,
    runtimeKind,
    workingDirectory: startedCtx.workingDirectory,
  };
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
  const tags = createSessionStartTags(startedCtx);
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
  session.setSessionCollection((current) =>
    removeAgentSession(current, {
      externalSessionId,
      runtimeKind: readStartedSessionRuntimeKind(startedCtx),
      workingDirectory: startedCtx.workingDirectory,
    }),
  );

  try {
    await runOrchestratorTask(
      "start-session-stop-after-persist-failure",
      async () => runtime.adapter.stopSession(toStartedSessionStopTarget(startedCtx)),
      { tags: createSessionStartTags(startedCtx) },
    );
  } catch (stopError) {
    throw new Error(
      `Failed to persist started session "${externalSessionId}": ${errorMessage(error)}. Failed to stop the started session during rollback: ${errorMessage(stopError)}`,
      { cause: stopError },
    );
  }

  throw new Error(
    `Failed to persist started session "${externalSessionId}": ${errorMessage(error)}. The started session was stopped and removed locally.`,
    error instanceof Error ? { cause: error } : undefined,
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
        tags: createSessionStartTags(startedCtx),
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
