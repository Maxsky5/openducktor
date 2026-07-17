import { Effect } from "effect";
import type { McpHostBridgeServer } from "../adapters/mcp/mcp-host-bridge-server";
import type {
  DevServerServiceError,
  DisposableDevServerService,
} from "../application/dev-servers/dev-server-service";
import {
  causeToHostBoundaryError,
  type HostError,
  HostOperationError,
} from "../effect/host-errors";
import type { RuntimeRegistryPort } from "../ports/runtime-registry-port";

export type HostLifecycleLogger = {
  info(message: string): void | Promise<void>;
  error(message: string): void | Promise<void>;
};

export type HostShutdownStep = {
  label: string;
  run: () => Effect.Effect<void, DevServerServiceError | HostError>;
};

const formatRuntimeTaskLabel = (taskId: string | null): string => taskId ?? "workspace";

export const writeHostLifecycleLog = (
  logger: HostLifecycleLogger,
  level: "error" | "info",
  message: string,
): Effect.Effect<void, HostOperationError> =>
  Effect.tryPromise({
    try: async () => logger[level](message),
    catch: (cause) =>
      new HostOperationError({
        operation: `host.lifecycle.log-${level}`,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const runShutdownSteps = (
  steps: HostShutdownStep[],
  logger: HostLifecycleLogger,
): Effect.Effect<void, HostOperationError> =>
  Effect.gen(function* () {
    const errors: string[] = [];
    for (const step of steps) {
      yield* writeHostLifecycleLog(logger, "info", `Stopping ${step.label}...`);
      const result = yield* Effect.exit(step.run());
      if (result._tag === "Failure") {
        const cause = causeToHostBoundaryError(result.cause);
        const message = cause instanceof Error ? cause.message : String(cause);
        yield* writeHostLifecycleLog(logger, "error", `Failed to stop ${step.label}: ${message}`);
        errors.push(`${step.label}: ${message}`);
      } else {
        yield* writeHostLifecycleLog(logger, "info", `Stopped ${step.label}`);
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
        yield* writeHostLifecycleLog(logger, "info", "No dev servers are running");
        return;
      }

      for (const script of result.stoppedScripts) {
        yield* writeHostLifecycleLog(
          logger,
          "info",
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
      yield* writeHostLifecycleLog(logger, "info", "Stopping registered agent runtimes");
      const stoppedRuntimes = yield* runtimeRegistry.stopAllRuntimes();
      if (stoppedRuntimes.length === 0) {
        yield* writeHostLifecycleLog(logger, "info", "No active agent runtimes are registered");
        return;
      }
      for (const runtime of stoppedRuntimes) {
        yield* writeHostLifecycleLog(
          logger,
          "info",
          `Stopped ${runtime.kind} runtime ${runtime.runtimeId} for task ${formatRuntimeTaskLabel(
            runtime.taskId,
          )} (${runtime.role})`,
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
        ? bridge.close().pipe(
            Effect.mapError(
              (cause) =>
                new HostOperationError({
                  operation: "mcp-host-bridge.close",
                  message: cause.message,
                  cause,
                }),
            ),
          )
        : Effect.succeed(null);
      if (!result?.closed) {
        yield* writeHostLifecycleLog(logger, "info", "No MCP host bridge server is running");
        return;
      }

      yield* writeHostLifecycleLog(
        logger,
        "info",
        result.baseUrl ? `Stopped MCP host bridge at ${result.baseUrl}` : "Stopped MCP host bridge",
      );
    });
  },
});
