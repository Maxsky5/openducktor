import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import type { HostCommandHandlers } from "../router/host-command-router";

const requireNoArgs = (command: string, args: Record<string, unknown> | undefined): void => {
  if (args !== undefined && Object.keys(args).length > 0) {
    throw new Error(`${command} does not accept arguments.`);
  }
};

export const createRuntimeDefinitionsCommandHandlers = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
): HostCommandHandlers => ({
  runtime_definitions_list: (args) => {
    requireNoArgs("runtime_definitions_list", args);
    return runtimeDefinitionsService.listRuntimeDefinitions();
  },
});
