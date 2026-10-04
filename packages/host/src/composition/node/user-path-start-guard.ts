import { Effect } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type {
  ProcessEnvironmentError,
  ProcessEnvironmentResolution,
} from "../../infrastructure/process/process-environment";
import type { DevServerProcessPort } from "../../ports/dev-server-process-port";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";

const checkUserPath = (
  resolution: ProcessEnvironmentResolution,
  makeError: (error: ProcessEnvironmentError) => HostOperationErrorAggregate,
): Effect.Effect<void, HostOperationErrorAggregate> => {
  if (resolution.status === "ready") {
    return Effect.void;
  }
  return Effect.fail(makeError(resolution.error));
};

export const guardDevServerStart = (
  port: DevServerProcessPort,
  resolution: ProcessEnvironmentResolution,
): DevServerProcessPort => ({
  start(input) {
    return checkUserPath(
      resolution,
      (error) =>
        new HostOperationError({
          operation: "devServerProcess.resolveEnvironment",
          message: error.message,
          cause: error,
          details: { reason: error.reason, shell: error.shell },
        }),
    ).pipe(Effect.flatMap(() => port.start(input)));
  },
});

export const guardRuntimeStart = (
  starter: RuntimeStarterPort,
  resolution: ProcessEnvironmentResolution,
): RuntimeStarterPort => ({
  startRuntime(input) {
    return checkUserPath(
      resolution,
      (error) =>
        new HostOperationError({
          operation: "runtime.resolveEnvironment",
          message: `Failed to start ${input.descriptor.kind} runtime because the user PATH is unavailable. ${error.message}`,
          cause: error,
          details: {
            runtimeKind: input.descriptor.kind,
            reason: error.reason,
            shell: error.shell,
          },
        }),
    ).pipe(Effect.flatMap(() => starter.startRuntime(input)));
  },
});
