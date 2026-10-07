import type { AgentSessionControlSendInput, AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";

type LaunchControls = {
  cancelSessionBeforeStop: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
  cancelRecoveryBeforeSend: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
  shutdown: () => Effect.Effect<void>;
};

/** Retire launch recovery before ordinary sends, and join workers before Stop or shutdown. */
export const createNodeSessionLaunchControls = <
  Commands extends Pick<SessionLaunchRuntimePort, "stopSession" | "sendUserMessage">,
>(
  commands: Commands,
  launches: LaunchControls[],
) => ({
  commands: {
    ...commands,
    stopSession: (ref: AgentSessionLiveRef) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const canceled = yield* Effect.forEach(launches, (service) =>
            Effect.result(service.cancelSessionBeforeStop(ref)),
          );
          const failures = canceled.flatMap((result) =>
            result._tag === "Failure" ? [result.failure] : [],
          );
          // A failed recovery update must not prevent the requested native stop.
          const stopped = yield* Effect.result(commands.stopSession(ref));
          if (failures.length > 0) {
            if (failures.length > 1 || stopped._tag === "Failure")
              return yield* new HostOperationError({
                operation: "session-launch.stop",
                message: [
                  ...failures.map((failure) => failure.message),
                  ...(stopped._tag === "Failure"
                    ? [`Session stop failed: ${stopped.failure.message}`]
                    : []),
                ].join(" "),
                cause: {
                  recoveryFailures: failures,
                  stopFailure: stopped._tag === "Failure" ? stopped.failure : undefined,
                },
              });
            return yield* Effect.fail(failures[0]!);
          }
          if (stopped._tag === "Failure") return yield* Effect.fail(stopped.failure);
        }),
      ),
    sendUserMessage: (input: AgentSessionControlSendInput) =>
      Effect.forEach(launches, (service) => service.cancelRecoveryBeforeSend(input)).pipe(
        Effect.andThen(commands.sendUserMessage(input)),
      ),
  },
  shutdown: () => Effect.forEach(launches, (service) => service.shutdown()).pipe(Effect.asVoid),
});
