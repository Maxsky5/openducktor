import { Effect } from "effect";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { requireNoArgs } from "./command-inputs";

export const createRuntimeDefinitionsCommandHandlers = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
) =>
  ({
    runtime_definitions_list: (args) =>
      Effect.gen(function* () {
        yield* Effect.try({
          try: () => requireNoArgs("runtime_definitions_list", args),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : new HostValidationError({
                  message: cause instanceof Error ? cause.message : String(cause),
                  field: "args",
                }),
        });
        return yield* Effect.try({
          try: () => runtimeDefinitionsService.listRuntimeDefinitions(),
          catch: (cause) => toHostOperationError(cause, "runtimeDefinitions.list"),
        });
      }),
  }) satisfies HostCommandHandlerDefinitions;
