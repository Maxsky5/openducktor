import type {
  RuntimeExecutableCheck,
  RuntimeExecutableCheckInput,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  errorMessage,
  HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import { discoverToolFresh, type ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";

export type RuntimeExecutableCheckService = {
  check(
    input: RuntimeExecutableCheckInput,
  ): Effect.Effect<RuntimeExecutableCheck, HostOperationErrorAggregate>;
};

const invalidRow = (
  kind: RuntimeKind,
  path: string,
  cause: unknown,
): RuntimeExecutableCheckResult => ({
  kind,
  path,
  ok: false,
  version: null,
  error: errorMessage(cause),
});

const checkHealth = (runtimeHealth: RuntimeHealthPort, kind: RuntimeKind, executablePath: string) =>
  runtimeHealth.getRuntimeHealth(kind, executablePath).pipe(
    Effect.map((health): RuntimeExecutableCheckResult => ({
      kind,
      path: health.executablePath ?? executablePath,
      ok: health.ok,
      version: health.version,
      error: health.error ?? null,
    })),
  );

const checkRuntimeExecutable = ({
  input,
  kind,
  runtimeHealth,
  toolDiscovery,
}: {
  input: RuntimeExecutableCheckInput;
  kind: RuntimeKind;
  runtimeHealth: RuntimeHealthPort;
  toolDiscovery: ToolDiscoveryPort;
}) =>
  Effect.gen(function* () {
    // The health probe validates a supplied path, so only discovery needs a first step.
    if (input.mode === "validate") {
      return yield* checkHealth(runtimeHealth, kind, input.paths[kind] ?? "");
    }
    const discovery = yield* Effect.result(discoverToolFresh(toolDiscovery, kind));
    if (discovery._tag === "Failure") {
      return invalidRow(kind, "", discovery.failure);
    }
    return yield* checkHealth(runtimeHealth, kind, discovery.success.path);
  });

export const createRuntimeExecutableCheckService = ({
  runtimeDefinitionsService,
  runtimeHealth,
  toolDiscovery,
}: {
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeHealth: RuntimeHealthPort;
  toolDiscovery: ToolDiscoveryPort;
}): RuntimeExecutableCheckService => ({
  check(input) {
    return Effect.gen(function* () {
      const definitions = yield* Effect.try({
        try: () => runtimeDefinitionsService.listRuntimeDefinitions(),
        catch: (cause) =>
          new HostOperationError({
            operation: "runtimeExecutables.listDefinitions",
            message: errorMessage(cause),
            cause,
          }),
      });
      const definitionsToCheck = definitions.filter(
        (definition) => input.mode === "discover" || Object.hasOwn(input.paths, definition.kind),
      );
      const runtimes = yield* Effect.forEach(
        definitionsToCheck,
        (definition) =>
          checkRuntimeExecutable({
            input,
            kind: definition.kind,
            runtimeHealth,
            toolDiscovery,
          }),
        { concurrency: 3 },
      );
      return { runtimes };
    });
  },
});
