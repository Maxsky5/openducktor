import { Effect } from "effect";
import type { McpHostBridgeServer } from "../adapters/mcp/mcp-host-bridge-server";
import type {
  DevServerServiceError,
  DisposableDevServerService,
} from "../application/dev-servers/dev-server-service";
import type {
  TerminalService,
  TerminalServiceError,
} from "../application/terminals/terminal-service";
import {
  causeToHostBoundaryError,
  type HostError,
  HostOperationError,
} from "../effect/host-errors";
import type { RuntimeRegistryPort } from "../ports/runtime-registry-port";

export type HostLifecycleLogger = {
  info(message: string): Effect.Effect<void, unknown>;
  error(message: string): Effect.Effect<void, unknown>;
};

export type HostShutdownStep = {
  label: string;
  run: () => Effect.Effect<void, DevServerServiceError | HostError | TerminalServiceError>;
};

class HostLifecycleLoggingError extends HostOperationError {}

export const createStopTerminalsStep = (terminalService: TerminalService): HostShutdownStep => ({
  label: "interactive terminals",
  run: () => terminalService.dispose(),
});

const formatRuntimeTaskLabel = (taskId: string | null): string => taskId ?? "workspace";

export const writeHostLifecycleLog = (
  logger: HostLifecycleLogger,
  level: "error" | "info",
  message: string,
): Effect.Effect<void, HostOperationError> =>
  logger[level](message).pipe(
    Effect.mapError(
      (cause) =>
        new HostLifecycleLoggingError({
          operation: `host.lifecycle.log-${level}`,
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    ),
  );

const captureHostLifecycleLogFailure = (
  logger: HostLifecycleLogger,
  level: "error" | "info",
  message: string,
  currentFailure: HostOperationError | undefined,
): Effect.Effect<HostOperationError | undefined> =>
  Effect.either(writeHostLifecycleLog(logger, level, message)).pipe(
    Effect.map((result) =>
      result._tag === "Left" ? (currentFailure ?? result.left) : currentFailure,
    ),
  );

const isHostLifecycleLoggingFailure = (cause: unknown): cause is HostOperationError =>
  cause instanceof HostLifecycleLoggingError;

export const runShutdownSteps = (
  steps: HostShutdownStep[],
  logger: HostLifecycleLogger,
): Effect.Effect<void, HostOperationError> =>
  Effect.gen(function* () {
    const errors: string[] = [];
    let loggingFailure: HostOperationError | undefined;
    for (const step of steps) {
      loggingFailure = yield* captureHostLifecycleLogFailure(
        logger,
        "info",
        `Stopping ${step.label}...`,
        loggingFailure,
      );
      const result = yield* Effect.exit(step.run());
      if (result._tag === "Failure") {
        const cause = causeToHostBoundaryError(result.cause);
        if (isHostLifecycleLoggingFailure(cause)) {
          loggingFailure ??= cause;
          continue;
        }
        const message = cause instanceof Error ? cause.message : String(cause);
        loggingFailure = yield* captureHostLifecycleLogFailure(
          logger,
          "error",
          `Failed to stop ${step.label}: ${message}`,
          loggingFailure,
        );
        errors.push(`${step.label}: ${message}`);
      } else {
        loggingFailure = yield* captureHostLifecycleLogFailure(
          logger,
          "info",
          `Stopped ${step.label}`,
          loggingFailure,
        );
      }
    }
    if (loggingFailure && errors.length > 0) {
      return yield* Effect.fail(
        new HostOperationError({
          message: `${errors.join("\n")}\nLifecycle logging: ${loggingFailure.message}`,
          operation: "host.shutdown",
          cause: loggingFailure,
          details: { failedSteps: errors, loggingFailure },
        }),
      );
    }
    if (loggingFailure) {
      return yield* Effect.fail(loggingFailure);
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
      let loggingFailure: HostOperationError | undefined;
      loggingFailure = yield* captureHostLifecycleLogFailure(
        logger,
        "info",
        "Stopping registered agent runtimes",
        loggingFailure,
      );

      const stopResult = yield* Effect.either(runtimeRegistry.stopAllRuntimes());
      if (stopResult._tag === "Left") {
        if (!loggingFailure) {
          return yield* Effect.fail(stopResult.left);
        }
        return yield* Effect.fail(
          new HostOperationError({
            operation: "host.shutdown.runtimes",
            message: `${stopResult.left.message}\nLifecycle logging: ${loggingFailure.message}`,
            cause: stopResult.left,
            details: {
              runtimeFailure: stopResult.left,
              loggingFailure,
            },
          }),
        );
      }
      const stoppedRuntimes = stopResult.right;
      if (stoppedRuntimes.length === 0) {
        loggingFailure = yield* captureHostLifecycleLogFailure(
          logger,
          "info",
          "No active agent runtimes are registered",
          loggingFailure,
        );
        if (loggingFailure) {
          return yield* Effect.fail(loggingFailure);
        }
        return;
      }
      for (const runtime of stoppedRuntimes) {
        loggingFailure = yield* captureHostLifecycleLogFailure(
          logger,
          "info",
          `Stopped ${runtime.kind} runtime ${runtime.runtimeId} for task ${formatRuntimeTaskLabel(
            runtime.taskId,
          )} (${runtime.role})`,
          loggingFailure,
        );
      }
      if (loggingFailure) {
        return yield* Effect.fail(loggingFailure);
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
