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
      runShutdownSteps(
        [
          {
            label: "first",
            async run() {
              calls.push("first");
              throw new Error("first failed");
            },
          },
          {
            label: "second",
            async run() {
              calls.push("second");
            },
          },
          {
            label: "third",
            async run() {
              calls.push("third");
              throw new Error("third failed");
            },
          },
        ],
        logger,
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

    await expect(runShutdownSteps([step], logger)).rejects.toThrow(
      "MCP host bridge: bridge close failed",
    );
  });
});
