import { describe, expect, test } from "bun:test";
import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Deferred, Effect, Fiber, Option } from "effect";
import { HostDependencyError, HostValidationError } from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createRuntimeDefinitionsService } from "./runtime-definitions-service";
import { createRuntimeExecutableCheckService } from "./runtime-executable-check-service";

interface PathsContract extends Record<RuntimeKind, string> {}

const paths: PathsContract = {
  opencode: "/tools/opencode",
  codex: "/tools/codex",
  claude: "/tools/claude",
};

const toolDiscovery: ToolDiscoveryPort = {
  discoverTool(toolId) {
    if (toolId === "codex") {
      return Effect.fail(
        new HostDependencyError({ dependency: "codex", message: "codex is not installed" }),
      );
    }
    // SAFETY: This test controls the fixture and supplies `RuntimeKind` used by this case.
    return Effect.succeed({
      displayLabel: "System PATH",
      path: paths[toolId as RuntimeKind],
      sourceCategory: "system_path",
    });
  },
  resolveTool(toolId) {
    if (toolId === "opencode" || toolId === "codex" || toolId === "claude") {
      return Effect.succeed({
        path: paths[toolId],
        provenance: "path",
        displayLabel: "test discovery",
        sourceCategory: "system_path",
      });
    }
    return Effect.fail(
      new HostDependencyError({ dependency: toolId, message: `${toolId} missing` }),
    );
  },
  resolveToolPath(toolId) {
    return this.resolveTool(toolId).pipe(Effect.map((tool) => tool.path));
  },
  validateToolPath(toolId, executablePath) {
    if (executablePath.length === 0) {
      return Effect.fail(
        new HostValidationError({
          field: `agentRuntimes.${toolId}.executablePath`,
          message: `Saved ${toolId} path is empty`,
        }),
      );
    }
    return Effect.succeed({
      displayLabel: "Saved path",
      path: executablePath,
      sourceCategory: "provided_path",
    });
  },
};

const runtimeHealth: RuntimeHealthPort = {
  getRuntimeHealth(kind, executablePath) {
    return Effect.succeed({
      kind,
      enabled: true,
      ok: true,
      executablePath,
      version: `${kind} 1.0.0`,
      error: null,
    } satisfies RuntimeHealth);
  },
};

describe("runtime executable check service", () => {
  const service = createRuntimeExecutableCheckService({
    runtimeDefinitionsService: createRuntimeDefinitionsService(),
    runtimeHealth,
    toolDiscovery,
  });

  test("returns one row for every runtime and treats a discovery miss as row data", async () => {
    const result = await Effect.runPromise(service.check({ mode: "discover" }));

    expect(result.runtimes).toHaveLength(3);
    expect(result.runtimes.find((row) => row.kind === "opencode")).toMatchObject({
      path: "/tools/opencode",
      ok: true,
      version: "opencode 1.0.0",
    });
    expect(result.runtimes.find((row) => row.kind === "codex")).toMatchObject({
      path: "",
      ok: false,
      error: "codex is not installed",
    });
  });

  test("validates supplied paths without automatic discovery", async () => {
    const result = await Effect.runPromise(
      service.check({
        mode: "validate",
        paths: { opencode: "/custom/opencode", codex: "", claude: "/custom/claude" },
      }),
    );

    expect(result.runtimes.find((row) => row.kind === "opencode")).toMatchObject({
      path: "/custom/opencode",
      ok: true,
    });
    expect(result.runtimes.find((row) => row.kind === "codex")).toMatchObject({
      path: "",
      ok: false,
      error: "Saved codex path is empty",
    });
  });

  test("validates only the supplied runtime path", async () => {
    const result = await Effect.runPromise(
      service.check({ mode: "validate", paths: { codex: "/custom/codex" } }),
    );

    expect(result.runtimes).toEqual([
      {
        kind: "codex",
        path: "/custom/codex",
        ok: true,
        version: "codex 1.0.0",
        error: null,
      },
    ]);
  });

  test("checks independent runtimes concurrently and preserves definition order", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const allStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const startedKinds: RuntimeKind[] = [];
        const concurrentRuntimeHealth: RuntimeHealthPort = {
          getRuntimeHealth(kind, executablePath) {
            return Effect.gen(function* () {
              startedKinds.push(kind);
              if (startedKinds.length === 3) {
                yield* Deferred.succeed(allStarted, undefined);
              }
              yield* Deferred.await(release);
              return {
                kind,
                enabled: true,
                ok: true,
                executablePath,
                version: `${kind} 1.0.0`,
                error: null,
              } satisfies RuntimeHealth;
            });
          },
        };
        const concurrentService = createRuntimeExecutableCheckService({
          runtimeDefinitionsService: createRuntimeDefinitionsService(),
          runtimeHealth: concurrentRuntimeHealth,
          toolDiscovery: {
            ...toolDiscovery,
            discoverTool(toolId) {
              // SAFETY: This test controls the fixture and supplies `RuntimeKind` used by this case.
              return Effect.succeed({
                displayLabel: "System PATH",
                path: paths[toolId as RuntimeKind],
                sourceCategory: "system_path",
              });
            },
          },
        });
        const checkFiber = yield* Effect.fork(concurrentService.check({ mode: "discover" }));
        const startedTogether = yield* Deferred.await(allStarted).pipe(
          Effect.timeoutOption("250 millis"),
        );
        yield* Deferred.succeed(release, undefined);
        const checked = yield* Fiber.join(checkFiber);
        return { checked, startedTogether };
      }),
    );

    expect(Option.isSome(result.startedTogether)).toBeTrue();
    expect(result.checked.runtimes.map((row) => row.kind)).toEqual(["opencode", "codex", "claude"]);
  });
});
