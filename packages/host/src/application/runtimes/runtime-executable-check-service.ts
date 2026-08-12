import type {
  RuntimeExecutableCheck,
  RuntimeExecutableCheckInput,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
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
  ): Effect.Effect<RuntimeExecutableCheck, HostOperationError>;
};

const invalidRow = (
  kind: RuntimeKind,
  path: string,
  error: unknown,
): RuntimeExecutableCheckResult => ({
  kind,
  path,
  ok: false,
  version: null,
  error: errorMessage(error),
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
      const runtimes: RuntimeExecutableCheckResult[] = [];
      for (const definition of definitions) {
        const kind = definition.kind;
        const suppliedPath = input.mode === "validate" ? (input.paths[kind] ?? "") : "";
        const resolution = yield* Effect.either(
          input.mode === "discover"
            ? discoverToolFresh(toolDiscovery, kind)
            : validateExactToolPath(toolDiscovery, kind, suppliedPath),
        );
        if (resolution._tag === "Left") {
          runtimes.push(invalidRow(kind, suppliedPath, resolution.left));
          continue;
        }

        const executablePath = resolution.right.path;
        const health = yield* runtimeHealth.getRuntimeHealth(kind, executablePath);
        runtimes.push({
          kind,
          path: health.executablePath ?? executablePath,
          ok: health.ok,
          version: health.version,
          error: health.error ?? null,
        });
      }
      return { runtimes };
    });
  },
});
