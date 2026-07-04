import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Effect } from "effect";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createSourceRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { HostLifecycleLogger } from "../host-lifecycle";
import { createNodeEffectHostCommandRouter } from "./create-node-host-command-router";

const runtimeDistribution = createSourceRuntimeDistribution(
  path.resolve(import.meta.dir, "../../../../.."),
);

const createRuntimeRegistry = (): RuntimeRegistryPort =>
  ({
    stopAllRuntimes: () => Effect.succeed([]),
  }) as unknown as RuntimeRegistryPort;

const createMcpHostBridge = (): McpHostBridgeServer =>
  ({
    close: () => Effect.succeed({ baseUrl: null, closed: false }),
  }) as unknown as McpHostBridgeServer;

const createLogger = () => {
  const infos: string[] = [];
  const errors: string[] = [];
  const logger: HostLifecycleLogger = {
    error: (message) => {
      errors.push(String(message));
    },
    info: (message) => {
      infos.push(String(message));
    },
  };
  return { errors, infos, logger };
};

const createRouter = (input: { logger: HostLifecycleLogger }) =>
  createNodeEffectHostCommandRouter({
    lifecycleLogger: input.logger,
    mcpHostBridge: createMcpHostBridge(),
    runtimeDistribution,
    runtimeRegistry: createRuntimeRegistry(),
    taskStore: {} as TaskStorePort,
  });

describe("createNodeEffectHostCommandRouter", () => {
  test("stops managed dev servers during normal host disposal", async () => {
    const { infos, logger } = createLogger();

    await Effect.runPromise(createRouter({ logger }).dispose());

    expect(infos).toContain("No dev servers are running");
  });
});
