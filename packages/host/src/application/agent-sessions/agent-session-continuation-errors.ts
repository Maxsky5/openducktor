import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { type HostError, HostResourceError } from "../../effect/host-errors";
import type { AgentSessionControlContinueInterruptedTurnInput } from "../../ports/agent-session-live-adapter-port";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";

export const continuationSessionRef = (
  input: AgentSessionControlContinueInterruptedTurnInput,
): AgentSessionLiveRef => ({
  repoPath: input.repoPath,
  runtimeKind: input.runtimeKind,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
});

export const toContinuationResolutionError = (
  cause: HostError,
  input: AgentSessionControlContinueInterruptedTurnInput,
): HostError => {
  if (cause instanceof HostResourceError && cause.resource === "agent_session_control_adapter") {
    return new AgentSessionResumeError({
      reason: "unsupported",
      sessionRef: continuationSessionRef(input),
      operation: "agent-session.continue-interrupted-turn",
      message: cause.message,
      cause,
    });
  }
  if (cause instanceof HostResourceError && cause.resource === "agent_session_live_adapter") {
    return new AgentSessionResumeError({
      reason: "runtime_unavailable",
      sessionRef: continuationSessionRef(input),
      operation: "agent-session.continue-interrupted-turn",
      message: cause.message,
      cause,
    });
  }
  return cause;
};
