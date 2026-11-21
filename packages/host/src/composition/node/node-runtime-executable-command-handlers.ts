import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createRuntimeExecutableCheckService } from "../../application/runtimes/runtime-executable-check-service";
import { createRuntimeDefinitionsCommandHandlers } from "../../interface/commands/runtime-definitions-command-handlers";
import { createRuntimeExecutableCommandHandlers } from "../../interface/commands/runtime-executable-command-handlers";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

/** The commands that read the runtime definitions and check their executables. */
export const createNodeRuntimeExecutableCommandHandlers = ({
  runtimeDefinitionsService,
  runtimeHealth,
  toolDiscovery,
}: {
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeHealth: RuntimeHealthPort;
  toolDiscovery: ToolDiscoveryPort;
}) => ({
  ...createRuntimeDefinitionsCommandHandlers(runtimeDefinitionsService),
  ...createRuntimeExecutableCommandHandlers(
    createRuntimeExecutableCheckService({
      runtimeDefinitionsService,
      runtimeHealth,
      toolDiscovery,
    }),
  ),
});
