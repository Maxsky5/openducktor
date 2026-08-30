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
import {
  discoverToolFresh,
  type ToolDiscoveryPort,
  validateExactToolPath,
} from "../../ports/tool-discovery-port";
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
    const suppliedPath = input.mode === "validate" ? (input.paths[kind] ?? "") : "";
    const resolution = yield* Effect.either(
      input.mode === "discover"
        ? discoverToolFresh(toolDiscovery, kind)
        : validateExactToolPath(toolDiscovery, kind, suppliedPath),
    );
    if (resolution._tag === "Left") {
      return invalidRow(kind, suppliedPath, resolution.left);
    }

    const executablePath = resolution.right.path;
    const health = yield* runtimeHealth.getRuntimeHealth(kind, executablePath);
    return {
      kind,
      path: health.executablePath ?? executablePath,
      ok: health.ok,
      version: health.version,
      error: health.error ?? null,
    } satisfies RuntimeExecutableCheckResult;
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
