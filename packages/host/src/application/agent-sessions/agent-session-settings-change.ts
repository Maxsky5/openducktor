import type {
  AgentSpeedRuntimeObservation,
  AgentSessionSpeedState,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";

/** The caller holds the session lock and turn starts until this change ends. */
export const changeSessionSettings = ({
  adapter,
  ref,
  previous,
  choice,
  apply,
  restore,
  save,
}: {
  adapter: AgentSessionRuntimeAdapterPort;
  ref: AgentSessionLiveRef;
  previous: AgentSessionSpeedState;
  choice: string | null;
  apply: Effect.Effect<AgentSpeedRuntimeObservation, HostError>;
  restore: Effect.Effect<AgentSpeedRuntimeObservation, HostError>;
  save: Effect.Effect<Effect.Effect<void, HostError>, HostError>;
}): Effect.Effect<AgentSessionSpeedState, HostError> =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const failAndRestore = (failure: HostError) =>
        Effect.gen(function* () {
          const restored = yield* Effect.result(restore);
          if (restored._tag === "Success" && previous.choice !== null) {
            yield* adapter.setSessionSpeedState(ref, {
              ...previous,
              availability: restored.success.availability ?? previous.availability,
              processing: restored.success.processing ?? previous.processing,
              synchronization: "confirmed",
            });
            return yield* Effect.fail(failure);
          }
          const reason = {
            code: "settings_uncertain",
            message: `${failure.message} The prior session settings could not be confirmed.`,
            nextAction: "Set speed explicitly before sending another message.",
          };
          yield* adapter.setSessionSpeedState(ref, {
            ...previous,
            synchronization: "uncertain",
            reason,
          });
          return yield* new HostOperationError({
            operation: "agent-session.change-settings",
            message: reason.message,
            cause: {
              failure,
              restoreFailure: restored._tag === "Failure" ? restored.failure : undefined,
            },
          });
        });

      const pending = yield* Effect.result(
        adapter.setSessionSpeedState(ref, { ...previous, synchronization: "pending" }),
      );
      if (pending._tag === "Failure") {
        yield* adapter.setSessionSpeedState(ref, previous);
        return yield* Effect.fail(pending.failure);
      }
      const applied = yield* Effect.result(apply);
      if (applied._tag === "Failure") return yield* failAndRestore(applied.failure);
      const saved = yield* Effect.result(save);
      if (saved._tag === "Failure") return yield* failAndRestore(saved.failure);
      const confirmed: AgentSessionSpeedState = {
        choice,
        synchronization: choice === null ? "unapplied" : "confirmed",
        availability: applied.success.availability ?? previous.availability,
        processing: applied.success.processing ?? previous.processing,
      };
      // A failed publish must not undo a saved choice.
      yield* adapter.setSessionSpeedState(ref, confirmed);
      yield* saved.success;
      return confirmed;
    }),
  );
