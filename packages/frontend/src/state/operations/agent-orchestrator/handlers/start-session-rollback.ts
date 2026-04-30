import { errorMessage } from "@/lib/errors";
import { runOrchestratorTask } from "../support/async-side-effects";
import type {
  RuntimeDependencies,
  SessionDependencies,
  StartedSessionContext,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { createSessionStartTags } from "./start-session-support";

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
      async () => runtime.adapter.stopSession(tags.externalSessionId),
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
  session.setSessionsById((current) => {
    if (!(externalSessionId in current)) {
      return current;
    }
    const next = { ...current };
    delete next[externalSessionId];
    return next;
  });

  try {
    await runOrchestratorTask(
      "start-session-stop-after-persist-failure",
      async () => runtime.adapter.stopSession(externalSessionId),
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
    await runOrchestratorTask(reason, async () => runtime.adapter.stopSession(externalSessionId), {
      tags: createSessionStartTags(startedCtx),
    });
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
