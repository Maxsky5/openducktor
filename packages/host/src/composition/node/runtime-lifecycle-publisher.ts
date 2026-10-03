import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { Effect } from "effect";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import type { CreateRuntimeRegistryInput } from "../../adapters/runtimes/runtime-registry";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";

export const createLiveSessionPublisher =
  (eventBus: HostEventBusPort | undefined) =>
  (envelope: AgentSessionLiveEnvelope): void => {
    if (!eventBus) {
      throw new HostResourceError({
        resource: "host-event-bus",
        operation: "agent-session-live.publish",
        message: "Live agent-session events require a configured host event bus.",
      });
    }
    eventBus.publish({ channel: "openducktor://agent-session-live-event", payload: envelope });
  };

export const createRuntimeLifecyclePublisher =
  (
    liveState: Pick<AgentSessionLiveStateService, "publishRuntimeChange">,
    onBackgroundFailure: (failure: HostOperationError) => Effect.Effect<void>,
  ): NonNullable<CreateRuntimeRegistryInput["onRuntimeChanged"]> =>
  (runtime, state) =>
    liveState
      .publishRuntimeChange(
        { runtimeId: runtime.runtimeId, repoPath: runtime.repoPath, runtimeKind: runtime.kind },
        state,
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation: "runtime.publish-change",
              message: "Cannot publish the runtime change. Check the host event bus.",
              cause,
            }),
        ),
        Effect.catchTag("HostOperationError", onBackgroundFailure),
      );
