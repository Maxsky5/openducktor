import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { RuntimeInfo } from "../runtime/runtime";
import { runOrchestratorTask } from "../support/async-side-effects";
import { SessionLaunchStopError } from "./session-launch-errors";
import type {
  RuntimeDependencies,
  SessionStartTags,
  StartedSessionContext,
} from "./start-session.types";

const toStartedSessionTags = (startedCtx: StartedSessionContext): SessionStartTags => ({
  repoPath: startedCtx.repoPath,
  taskId: startedCtx.taskId,
  role: startedCtx.role,
  externalSessionId: startedCtx.summary.externalSessionId,
});

type SessionBootstrap = NonNullable<RuntimeInfo["bootstrap"]>;

export const rollbackBootstrapAfterStartFailure = async ({
  cause,
  bootstrap,
}: {
  cause: unknown;
  bootstrap: { abort: () => Promise<void> };
}): Promise<never> => {
  if (cause instanceof SessionLaunchStopError) {
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

export const stopStoredWorkflowSessionAfterLaunchFailure = async ({
  message,
  cause,
  startedCtx,
  identity,
  readSessionSnapshot,
  replaceSession,
  clearSessionObservationState,
  runtime,
  stopReason,
  bootstrapToComplete,
}: {
  message: string;
  cause: unknown;
  startedCtx: StartedSessionContext;
  identity: AgentSessionIdentity;
  readSessionSnapshot: (identity: AgentSessionIdentity) => AgentSessionState | null;
  replaceSession: (session: AgentSessionState) => void;
  clearSessionObservationState: (identity: AgentSessionIdentity) => void;
  runtime: RuntimeDependencies;
  stopReason: string;
  bootstrapToComplete?: SessionBootstrap;
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

  const storedSession = readSessionSnapshot(identity);
  if (storedSession) {
    replaceSession({
      ...storedSession,
      status: "stopped",
      runtimeStatusMessage: null,
      stopRequestedAt: null,
      pendingApprovals: [],
      pendingQuestions: [],
    });
  }
  clearSessionObservationState(identity);

  let bootstrapError: unknown;
  if (bootstrapToComplete) {
    try {
      await bootstrapToComplete.complete();
    } catch (error) {
      bootstrapError = error;
    }
  }

  const progress = ["The started session was stopped.", "The stored task session was kept."];
  if (bootstrapToComplete && bootstrapError === undefined) {
    progress.push("The task worktree bootstrap was completed to keep its resources.");
  } else if (bootstrapError !== undefined) {
    progress.push(
      `Failed to complete the task worktree bootstrap: ${errorMessage(bootstrapError)}.`,
    );
  }

  throw new Error(
    `${message} ${progress.join(" ")}`,
    cause instanceof Error ? { cause } : undefined,
  );
};
