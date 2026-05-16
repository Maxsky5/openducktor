import { Cause, Effect } from "effect";
import type { BeadsTaskRepository } from "../adapters/beads/beads-task-repository";
import type { McpHostBridgeServer } from "../adapters/mcp/mcp-host-bridge-server";
import type {
  DevServerServiceError,
  DisposableDevServerService,
} from "../application/dev-servers/dev-server-service";
import { type HostError, HostOperationError } from "../effect/host-errors";
import type { RuntimeRegistryPort } from "../ports/runtime-registry-port";

export type HostLifecycleLogger = {
  info(message: string): void;
  error(message: string): void;
};

export type HostShutdownStep = {
  label: string;
  run: () => Effect.Effect<void, DevServerServiceError | HostError>;
};

const formatRuntimeTaskLabel = (taskId: string | null): string => taskId ?? "workspace";

export const runShutdownSteps = (
  steps: HostShutdownStep[],
  logger: HostLifecycleLogger,
): Effect.Effect<void, HostOperationError> =>
  Effect.gen(function* () {
    const errors: string[] = [];
    for (const step of steps) {
      const result = yield* Effect.exit(step.run());
      if (result._tag === "Failure") {
        const message = Cause.pretty(result.cause);
        logger.error(`Failed to stop ${step.label}: ${message}`);
        errors.push(`${step.label}: ${message}`);
      }
    }
    if (errors.length > 0) {
      return yield* Effect.fail(
        new HostOperationError({
          message: errors.join("\n"),
          operation: "host.shutdown",
          details: { failedSteps: errors },
        }),
      );
    }
  });

export const createStopDevServersStep = (
  devServerService: DisposableDevServerService,
  logger: HostLifecycleLogger,
): HostShutdownStep => ({
  label: "dev servers",
  run() {
    return Effect.gen(function* () {
      const result = yield* devServerService.stopAll();
      if (result.stoppedScripts.length === 0) {
        logger.info("No dev servers are running");
        return;
      }

      for (const script of result.stoppedScripts) {
        logger.info(
          `Stopped dev server ${script.name} (${script.scriptId}) for task ${script.taskId} with pid ${script.pid}`,
        );
      }
    });
  },
});

export const createStopRuntimesStep = (
  runtimeRegistry: RuntimeRegistryPort,
  logger: HostLifecycleLogger,
): HostShutdownStep => ({
  label: "active agent runtimes",
  run() {
    return Effect.gen(function* () {
      if (runtimeRegistry.stopAllRuntimes) {
        logger.info("Stopping registered agent runtimes");
        const stoppedRuntimes = yield* runtimeRegistry.stopAllRuntimes();
        if (stoppedRuntimes.length === 0) {
          logger.info("No active agent runtimes are registered");
          return;
        }
        for (const runtime of stoppedRuntimes) {
          logger.info(
            `Stopped ${runtime.kind} runtime ${runtime.runtimeId} for task ${formatRuntimeTaskLabel(
              runtime.taskId,
            )} (${runtime.role})`,
          );
        }
        return;
      }

      const runtimes = yield* runtimeRegistry.listRuntimes();
      if (runtimes.length === 0) {
        logger.info("No active agent runtimes are registered");
        return;
      }

      logger.info(`Stopping ${runtimes.length} active agent runtime(s)`);
      const errors: string[] = [];
      for (const runtime of runtimes) {
        logger.info(
          `Stopping ${runtime.kind} runtime ${runtime.runtimeId} for task ${formatRuntimeTaskLabel(
            runtime.taskId,
          )} (${runtime.role})`,
        );
        const result = yield* Effect.exit(runtimeRegistry.stopRuntime(runtime.runtimeId));
        if (result._tag === "Failure") {
          const message = Cause.pretty(result.cause);
          errors.push(`Failed stopping runtime ${runtime.runtimeId}: ${message}`);
        }
      }
      if (errors.length > 0) {
        return yield* Effect.fail(
          new HostOperationError({
            message: errors.join("\n"),
            operation: "runtime-registry.stop-all",
            details: { failedRuntimes: errors },
          }),
        );
      }
    });
  },
});

export const createStopMcpHostBridgeStep = (
  bridge: McpHostBridgeServer | undefined,
  logger: HostLifecycleLogger,
): HostShutdownStep => ({
  label: "MCP host bridge",
  run() {
    return Effect.gen(function* () {
      const result = yield* bridge
        ? Effect.tryPromise({
            try: () => bridge.close(),
            catch: (cause) =>
              new HostOperationError({
                operation: "mcp-host-bridge.close",
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          })
        : Effect.succeed(null);
      if (!result?.closed) {
        logger.info("No MCP host bridge server is running");
        return;
      }

      logger.info(
        result.baseUrl ? `Stopped MCP host bridge at ${result.baseUrl}` : "Stopped MCP host bridge",
      );
    });
  },
});

export const createStopSharedDoltServerStep = (
  taskStore: BeadsTaskRepository | null,
  logger: HostLifecycleLogger,
): HostShutdownStep => ({
  label: "shared Dolt server",
  run() {
    return Effect.gen(function* () {
      if (!taskStore) {
        logger.info("No shared Dolt server owned by this OpenDucktor process");
        return;
      }

      const result = yield* taskStore.close();
      if (result.stoppedSharedDoltServers === 0) {
        logger.info("No shared Dolt server owned by this OpenDucktor process");
        return;
      }

      logger.info("Shared Dolt server stopped");
    });
  },
});
