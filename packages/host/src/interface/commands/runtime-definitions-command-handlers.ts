import { Effect } from "effect";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";

const requireNoArgs = (command: string, args: HostCommandArgs): void => {
  if (args !== undefined && Object.keys(args).length > 0) {
    throw new HostValidationError({
      message: `${command} does not accept arguments.`,
      field: "args",
      details: { command },
    });
  }
};

export const createRuntimeDefinitionsCommandHandlers = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
) =>
  ({
    runtime_definitions_list: (args) =>
      Effect.try({
        try: () => {
          requireNoArgs("runtime_definitions_list", args);
          return runtimeDefinitionsService.listRuntimeDefinitions();
        },
        catch: (cause) =>
          cause instanceof HostValidationError
            ? cause
            : new HostValidationError({
                message: cause instanceof Error ? cause.message : String(cause),
                field: "args",
              }),
      }),
  }) satisfies HostCommandHandlerDefinitions;
