import { Effect } from "effect";
import type { HostError, HostOperationErrorAggregate } from "../../effect/host-errors";
import type {
  AgentSessionRuntimeAdapterPort,
  AgentSessionLiveAdapterMutation,
} from "../../ports/agent-session-live-adapter-port";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import type { createClaudeLiveSessionState } from "./claude-live-session-state";

export const createClaudeSessionSettingsControls = ({
  service,
  runtimeId,
  sessionError,
  state,
  commit,
  runControlMutation,
}: {
  service: Pick<
    ClaudeAgentSdkService,
    "holdSessionTurns" | "setSessionSpeedState" | "updateSessionSpeed" | "updateSessionModel"
  >;
  runtimeId: string;
  sessionError: (operation: string, id: string) => (cause: unknown) => HostOperationErrorAggregate;
  state: ReturnType<typeof createClaudeLiveSessionState>;
  commit: <A>(
    operation: string,
    mutation: () => AgentSessionLiveAdapterMutation<A>,
  ) => Effect.Effect<A, HostError>;
  runControlMutation: <A>(effect: Effect.Effect<A, HostError>) => Effect.Effect<A, HostError>;
}): Pick<
  AgentSessionRuntimeAdapterPort,
  "holdSessionTurns" | "setSessionSpeedState" | "updateSessionSpeed" | "updateSessionModel"
> => ({
  holdSessionTurns: (input) =>
    service.holdSessionTurns(input, runtimeId).pipe(
      Effect.mapError(
        sessionError("claude-live-session.hold-session-turns", input.externalSessionId),
      ),
      Effect.map((release) =>
        release.pipe(
          Effect.mapError(
            sessionError("claude-live-session.release-session-turns", input.externalSessionId),
          ),
        ),
      ),
    ),
  setSessionSpeedState: (input, speed) =>
    service.setSessionSpeedState(input, speed).pipe(
      Effect.mapError(sessionError("claude-live-session.set-speed-state", input.externalSessionId)),
      Effect.andThen(
        commit("claude-live-session.set-speed-state", () => ({
          value: undefined,
          changes: state.applySpeed(input, speed),
        })),
      ),
    ),
  updateSessionSpeed: (input, retainedState) =>
    service
      .updateSessionSpeed(input, retainedState)
      .pipe(
        Effect.mapError(sessionError("claude-live-session.update-speed", input.externalSessionId)),
      ),
  updateSessionModel: (input) =>
    runControlMutation(
      service
        .updateSessionModel(input, runtimeId)
        .pipe(
          Effect.mapError(
            sessionError("claude-live-session.update-session-model", input.externalSessionId),
          ),
        ),
    ),
});
