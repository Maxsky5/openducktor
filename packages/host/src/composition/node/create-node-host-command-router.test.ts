import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Effect } from "effect";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createSourceRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import type { HostEventBusPort } from "../../events/host-event-bus";
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
    ensureConnection: () => Effect.succeed({ baseUrl: "http://127.0.0.1:5000" }),
    ensureExternalDiscoveryReady: () => Effect.succeed({ baseUrl: "http://127.0.0.1:5000" }),
    close: () => Effect.succeed({ baseUrl: null, closed: false }),
  }) as unknown as McpHostBridgeServer;

const createEventBus = (): HostEventBusPort => ({
  publish() {},
  subscribe() {
    return () => {};
  },
});

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

const createRouter = (input: { eventBus?: HostEventBusPort; logger: HostLifecycleLogger }) =>
  createNodeEffectHostCommandRouter({
    ...(input.eventBus ? { eventBus: input.eventBus } : {}),
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

  test("stops the pull request sync loop during host disposal", async () => {
    const { infos, logger } = createLogger();
    const router = createRouter({ eventBus: createEventBus(), logger });

    await Effect.runPromise(router.initialize());
    await Effect.runPromise(router.dispose());

    expect(infos).toContain("Stopping pull request sync loop...");
    expect(infos).toContain("Pull request sync loop stopped");
    expect(infos).toContain("Stopped pull request sync loop");
  });
});
