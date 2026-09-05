import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
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
}): Promise<never> => {
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

  if (stopError === undefined) {
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
  }

  if (stopError !== undefined) {
    throw new SessionLaunchStopError(
      `${message} Failed to stop the started session during rollback: ${errorMessage(stopError)}. Cleanup was not continued.`,
      { cause: stopError },
    );
  }

  const progress = ["The started session was stopped.", "The stored task session was kept."];
  throw new Error(
    `${message} ${progress.join(" ")}`,
    cause instanceof Error ? { cause } : undefined,
  );
};
