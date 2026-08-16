import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createRuntimeExecutableCheckService } from "../../application/runtimes/runtime-executable-check-service";
import { createRuntimeExecutableCommandHandlers } from "../../interface/commands/runtime-executable-command-handlers";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export const createNodeRuntimeExecutableCommandHandlers = ({
  runtimeDefinitionsService,
  runtimeHealth,
  toolDiscovery,
}: {
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeHealth: RuntimeHealthPort;
  toolDiscovery: ToolDiscoveryPort;
}) =>
  createRuntimeExecutableCommandHandlers(
    createRuntimeExecutableCheckService({
      runtimeDefinitionsService,
      runtimeHealth,
      toolDiscovery,
    }),
  );
