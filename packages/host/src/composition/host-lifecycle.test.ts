import { Cause, Effect } from "effect";
import { HostOperationError } from "../effect/host-errors";
import {
  createStopMcpHostBridgeStep,
  type HostLifecycleLogger,
  runShutdownSteps,
} from "./host-lifecycle";

const createLogger = (): HostLifecycleLogger & { infos: string[]; errors: string[] } => {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    info: (message) => {
      infos.push(message);
    },
    error: (message) => {
      errors.push(message);
    },
  };
};

describe("host lifecycle shutdown", () => {
  test("continues independent shutdown steps and rejects with labeled failures", async () => {
    const logger = createLogger();
    const calls: string[] = [];

    await expect(
      Effect.runPromise(
        runShutdownSteps(
          [
            {
              label: "first",
              run() {
                calls.push("first");
                return Effect.fail(
                  new HostOperationError({
                    operation: "test.first",
                    message: "first failed",
                  }),
                );
              },
            },
            {
              label: "second",
              run() {
                calls.push("second");
                return Effect.void;
              },
            },
            {
              label: "third",
              run() {
                calls.push("third");
                return Effect.fail(
                  new HostOperationError({
                    operation: "test.third",
                    message: "third failed",
                  }),
                );
              },
            },
          ],
          logger,
        ),
      ),
    ).rejects.toThrow("first: first failed\nthird: third failed");

    expect(calls).toEqual(["first", "second", "third"]);
    expect(logger.infos).toEqual([
      "Stopping first...",
      "Stopping second...",
      "Stopped second",
      "Stopping third...",
    ]);
    expect(logger.errors).toEqual([
      "Failed to stop first: first failed",
      "Failed to stop third: third failed",
    ]);
  });

  test("runs every shutdown step when lifecycle logging rejects", async () => {
    const persistenceError = new Error(
      "openducktor.logs.append failed for /tmp/openducktor-host.log",
    );
    const calls: string[] = [];
    const rejectingLogger: HostLifecycleLogger = {
      error: async () => {
        throw persistenceError;
      },
      info: async () => {
        throw persistenceError;
      },
    };

    const exit = await Effect.runPromiseExit(
      runShutdownSteps(
        ["first", "second", "third"].map((label) => ({
          label,
          run: () =>
            Effect.sync(() => {
              calls.push(label);
            }),
        })),
        rejectingLogger,
      ),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Array.from(Cause.failures(exit.cause))[0]).toMatchObject({
        _tag: "HostOperationError",
        operation: "host.lifecycle.log-info",
        cause: persistenceError,
      });
    }

    expect(calls).toEqual(["first", "second", "third"]);
  });

  test("propagates MCP host bridge close failures", async () => {
    const logger = createLogger();
    const step = createStopMcpHostBridgeStep(
      {
        ensureConnection() {
          return Effect.fail(
            new HostOperationError({
              operation: "test.ensureConnection",
              message: "ensureConnection should not be called",
            }),
          );
        },
        ensureExternalDiscoveryReady() {
          return Effect.fail(
            new HostOperationError({
              operation: "test.ensureExternalDiscoveryReady",
              message: "ensureExternalDiscoveryReady should not be called",
            }),
          );
        },
        close() {
          return Effect.fail(
            new HostOperationError({
              operation: "test.close",
              message: "bridge close failed",
            }),
          );
        },
      },
      logger,
    );

    await expect(Effect.runPromise(runShutdownSteps([step], logger))).rejects.toThrow(
      "MCP host bridge: bridge close failed",
    );
  });
});
