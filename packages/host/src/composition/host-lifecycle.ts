import type { BeadsTaskRepository } from "../adapters/beads/beads-task-repository";
import type { McpHostBridgeServer } from "../adapters/mcp/mcp-host-bridge-server";
import type { DisposableDevServerService } from "../application/dev-servers/dev-server-service";
import type { RuntimeRegistryPort } from "../ports/runtime-registry-port";

export type HostLifecycleLogger = {
  info(message: string): void;
  error(message: string): void;
};

export type HostShutdownStep = {
  label: string;
  run: () => Promise<void>;
};

const formatRuntimeTaskLabel = (taskId: string | null): string => taskId ?? "workspace";

export const runShutdownSteps = async (
  steps: HostShutdownStep[],
  logger: HostLifecycleLogger,
): Promise<void> => {
  const errors: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to stop ${step.label}: ${message}`);
      errors.push(`${step.label}: ${message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
};

export const createStopDevServersStep = (
  devServerService: DisposableDevServerService,
  logger: HostLifecycleLogger,
): HostShutdownStep => ({
  label: "dev servers",
  async run() {
    const result = await devServerService.stopAll();
    if (result.stoppedScripts.length === 0) {
      logger.info("No dev servers are running");
      return;
    }

    for (const script of result.stoppedScripts) {
      logger.info(
        `Stopped dev server ${script.name} (${script.scriptId}) for task ${script.taskId} with pid ${script.pid}`,
      );
    }
  },
});

export const createStopRuntimesStep = (
  runtimeRegistry: RuntimeRegistryPort,
  logger: HostLifecycleLogger,
): HostShutdownStep => ({
  label: "active agent runtimes",
  async run() {
    if (runtimeRegistry.stopAllRuntimes) {
      logger.info("Stopping registered agent runtimes");
      const stoppedRuntimes = await runtimeRegistry.stopAllRuntimes();
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

    const runtimes = await runtimeRegistry.listRuntimes();
    if (runtimes.length === 0) {
      logger.info("No active agent runtimes are registered");
      return;
    }

    logger.info(`Stopping ${runtimes.length} active agent runtime(s)`);
    const errors: string[] = [];
    for (const runtime of runtimes) {
      try {
        logger.info(
          `Stopping ${runtime.kind} runtime ${runtime.runtimeId} for task ${formatRuntimeTaskLabel(
            runtime.taskId,
          )} (${runtime.role})`,
        );
        await runtimeRegistry.stopRuntime(runtime.runtimeId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed stopping runtime ${runtime.runtimeId}: ${message}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }
  },
});

export const createStopMcpHostBridgeStep = (
  bridge: McpHostBridgeServer | undefined,
  logger: HostLifecycleLogger,
): HostShutdownStep => ({
  label: "MCP host bridge",
  async run() {
    const result = await bridge?.close();
    if (!result?.closed) {
      logger.info("No MCP host bridge server is running");
      return;
    }

    logger.info(
      result.baseUrl ? `Stopped MCP host bridge at ${result.baseUrl}` : "Stopped MCP host bridge",
    );
  },
});

export const createStopSharedDoltServerStep = (
  taskStore: BeadsTaskRepository | null,
  logger: HostLifecycleLogger,
): HostShutdownStep => ({
  label: "shared Dolt server",
  async run() {
    if (!taskStore) {
      logger.info("No shared Dolt server owned by this OpenDucktor process");
      return;
    }

    const result = await taskStore.close();
    if (result.stoppedSharedDoltServers === 0) {
      logger.info("No shared Dolt server owned by this OpenDucktor process");
      return;
    }

    logger.info("Shared Dolt server stopped");
  },
});
