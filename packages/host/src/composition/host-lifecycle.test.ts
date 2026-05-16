import { Effect } from "effect";
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
    info: (message) => infos.push(message),
    error: (message) => errors.push(message),
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
    expect(logger.errors).toEqual([
      "Failed to stop first: first failed",
      "Failed to stop third: third failed",
    ]);
  });

  test("propagates MCP host bridge close failures", async () => {
    const logger = createLogger();
    const step = createStopMcpHostBridgeStep(
      {
        async ensureConnection() {
          throw new Error("ensureConnection should not be called");
        },
        async ensureExternalDiscoveryReady() {
          throw new Error("ensureExternalDiscoveryReady should not be called");
        },
        async close() {
          throw new Error("bridge close failed");
        },
      },
      logger,
    );

    await expect(Effect.runPromise(runShutdownSteps([step], logger))).rejects.toThrow(
      "MCP host bridge: bridge close failed",
    );
  });
});
