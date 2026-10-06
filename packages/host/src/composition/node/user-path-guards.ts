import type { PersistedGlobalConfigV2 } from "@openducktor/contracts";
import { Effect } from "effect";
import type { RuntimeConfigInitializer } from "../../application/runtimes/runtime-config-initializer";
import type { ModelCatalogPreviewReader } from "../../application/runtimes/model-catalog-preview-service";
import { HostOperationError } from "../../effect/host-errors";
import type { DevServerProcessPort } from "../../ports/dev-server-process-port";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { UserEnvironmentPort, UserPathError } from "../../ports/user-environment-port";

/**
 * Fails while the user environment has no user PATH. The error message starts with `prefix`,
 * then gives the PATH error.
 */
const requireUserPath = (
  userEnvironment: UserEnvironmentPort,
  operation: string,
  prefix = "",
): Effect.Effect<void, HostOperationError<Pick<UserPathError, "reason" | "shell">>> =>
  Effect.suspend(() => {
    const { error } = userEnvironment.current();
    return error
      ? Effect.fail(
          new HostOperationError({
            operation,
            message: `${prefix}${error.message}`,
            cause: error,
            details: { reason: error.reason, shell: error.shell },
          }),
        )
      : Effect.void;
  });

export const guardDevServerStart = (
  port: DevServerProcessPort,
  userEnvironment: UserEnvironmentPort,
): DevServerProcessPort => ({
  start(input) {
    return requireUserPath(userEnvironment, "devServerProcess.resolveEnvironment").pipe(
      Effect.andThen(port.start(input)),
    );
  },
});

export const guardRuntimeStart = (
  starter: RuntimeStarterPort,
  userEnvironment: UserEnvironmentPort,
): RuntimeStarterPort => ({
  startRuntime(input) {
    return requireUserPath(
      userEnvironment,
      "runtime.resolveEnvironment",
      `Failed to start ${input.descriptor.kind} runtime because the user PATH is unavailable. `,
    ).pipe(Effect.andThen(starter.startRuntime(input)));
  },
});

export const guardRuntimeConfigInitializer =
  (initialize: RuntimeConfigInitializer, userEnvironment: UserEnvironmentPort) =>
  (legacyConfig: PersistedGlobalConfigV2 | null) =>
    requireUserPath(userEnvironment, "runtimeConfig.resolveEnvironment").pipe(
      Effect.andThen(initialize(legacyConfig)),
    );

export const guardModelCatalogPreview =
  (
    readModels: ModelCatalogPreviewReader,
    userEnvironment: UserEnvironmentPort,
  ): ModelCatalogPreviewReader =>
  (input) =>
    requireUserPath(
      userEnvironment,
      "modelCatalogPreview.resolveEnvironment",
      `Cannot load ${input.runtimeKind} models because the user PATH is unavailable. `,
    ).pipe(Effect.andThen(readModels(input)));
