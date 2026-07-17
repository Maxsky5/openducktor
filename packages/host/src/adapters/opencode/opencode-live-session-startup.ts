import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { OpenCodeLiveSessionAdapterPreparer } from "../agent-sessions/opencode-live-session-adapter";

export const startOpenCodeLiveSessionState = (input: {
  runtime: RuntimeInstanceSummary;
  runtimeId: string;
  prepareLiveSessionAdapter: OpenCodeLiveSessionAdapterPreparer;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  isRuntimeClosed: () => boolean;
  closeDescription: () => string | null;
  markRegistered: () => void;
  releaseLiveSessionState: Effect.Effect<void, HostOperationError>;
}): Effect.Effect<void, HostOperationError> =>
  Effect.gen(function* () {
    const prepared = yield* input.prepareLiveSessionAdapter(input.runtime).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "opencodeWorkspaceRuntime.prepareLiveSessionAdapter", {
          runtimeId: input.runtimeId,
        }),
      ),
    );
    if (input.isRuntimeClosed()) {
      yield* prepared.discard().pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.discardLiveSessionAdapter", {
            runtimeId: input.runtimeId,
          }),
        ),
      );
      return yield* Effect.fail(
        new HostOperationError({
          operation: "opencodeWorkspaceRuntime.prepareLiveSessionAdapter",
          message: `OpenCode process exited while its live-session adapter was being prepared: ${
            input.closeDescription() ?? "process exited"
          }`,
          details: { runtimeId: input.runtimeId, closeDescription: input.closeDescription() },
        }),
      );
    }

    const registration = yield* Effect.either(
      input.liveSessionLifecycle.registerRuntimeAdapter(prepared.adapter).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.registerLiveSessionAdapter", {
            runtimeId: input.runtimeId,
          }),
        ),
      ),
    );
    if (registration._tag === "Left") {
      const discard = yield* Effect.either(
        prepared.discard().pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, "opencodeWorkspaceRuntime.discardLiveSessionAdapter", {
              runtimeId: input.runtimeId,
            }),
          ),
        ),
      );
      if (discard._tag === "Left") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "opencodeWorkspaceRuntime.registerLiveSessionAdapter",
            message: `${registration.left.message}\nDiscard failed: ${discard.left.message}`,
            cause: registration.left,
            details: { runtimeId: input.runtimeId },
          }),
        );
      }
      return yield* Effect.fail(registration.left);
    }
    input.markRegistered();
    if (input.isRuntimeClosed()) {
      yield* input.releaseLiveSessionState;
      return yield* Effect.fail(
        new HostOperationError({
          operation: "opencodeWorkspaceRuntime.registerLiveSessionAdapter",
          message: `OpenCode process exited while its live-session adapter was being registered: ${
            input.closeDescription() ?? "process exited"
          }`,
          details: { runtimeId: input.runtimeId, closeDescription: input.closeDescription() },
        }),
      );
    }

    const forwarding = yield* Effect.either(
      prepared.startForwarding().pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.startLiveSessionForwarding", {
            runtimeId: input.runtimeId,
          }),
        ),
      ),
    );
    if (forwarding._tag === "Left") {
      const release = yield* Effect.either(input.releaseLiveSessionState);
      if (release._tag === "Left") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "opencodeWorkspaceRuntime.startLiveSessionForwarding",
            message: `${forwarding.left.message}\nRelease failed: ${release.left.message}`,
            cause: forwarding.left,
            details: { runtimeId: input.runtimeId },
          }),
        );
      }
      return yield* Effect.fail(forwarding.left);
    }
    if (input.isRuntimeClosed()) {
      yield* input.releaseLiveSessionState;
      return yield* Effect.fail(
        new HostOperationError({
          operation: "opencodeWorkspaceRuntime.startLiveSessionForwarding",
          message: `OpenCode process exited while live-session forwarding was starting: ${
            input.closeDescription() ?? "process exited"
          }`,
          details: { runtimeId: input.runtimeId, closeDescription: input.closeDescription() },
        }),
      );
    }
  });
