import { describe, expect, test } from "bun:test";
import type { RuntimeKind } from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { parsePersistedGlobalConfigV2 } from "../../config/global-config";
import { HostDependencyError, HostValidationError } from "../../effect/host-errors";
import type { ToolDiscoveryError, ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createRuntimeConfigInitializer } from "./runtime-config-initializer";

const createToolDiscovery = (
  paths: Partial<Record<RuntimeKind, string>>,
  failures: Partial<Record<RuntimeKind, ToolDiscoveryError>> = {},
): ToolDiscoveryPort => {
  const discover: ToolDiscoveryPort["discoverTool"] = (toolId) => {
    const failure = failures[toolId as RuntimeKind];
    if (failure) {
      return Effect.fail(failure);
    }
    const path = paths[toolId as RuntimeKind];
    if (!path) {
      return Effect.fail(
        new HostDependencyError({
          dependency: toolId,
          operation: "toolDiscovery.discoverTool",
          message: `${toolId} is not available`,
        }),
      );
    }
    return Effect.succeed({ displayLabel: toolId, path, sourceCategory: "system_path" });
  };
  return {
    discoverTool: discover,
    resolveTool: discover,
    resolveToolPath: (toolId) => discover(toolId).pipe(Effect.map(({ path }) => path)),
    validateToolPath: (toolId, executablePath) =>
      Effect.succeed({
        displayLabel: toolId,
        path: executablePath,
        sourceCategory: "provided_path",
      }),
  };
};

describe("runtime config initializer", () => {
  const initialize = createRuntimeConfigInitializer(
    createToolDiscovery({ opencode: "/tools/opencode", claude: "/tools/claude" }),
  );

  test("enables only detected runtimes for a new config", async () => {
    const config = await Effect.runPromise(initialize(null));

    expect(config.agentRuntimes.opencode).toMatchObject({
      enabled: true,
      executablePath: "/tools/opencode",
    });
    expect(config.agentRuntimes.codex).toMatchObject({ enabled: false, executablePath: "" });
    expect(config.agentRuntimes.claude).toMatchObject({
      enabled: true,
      executablePath: "/tools/claude",
    });
  });

  test("preserves version 2 enabled choices while backfilling valid paths", async () => {
    const legacy = parsePersistedGlobalConfigV2({
      version: 2,
      agentRuntimes: {
        opencode: { enabled: false },
        codex: { enabled: true },
        claude: { enabled: false },
      },
    });
    const config = await Effect.runPromise(initialize(legacy));

    expect(config.agentRuntimes.opencode.enabled).toBe(false);
    expect(config.agentRuntimes.opencode.executablePath).toBe("/tools/opencode");
    expect(config.agentRuntimes.codex.enabled).toBe(true);
    expect(config.agentRuntimes.codex.executablePath).toBe("");
  });

  test("persists discovered paths without a runtime readiness service", async () => {
    const config = await Effect.runPromise(
      createRuntimeConfigInitializer(
        createToolDiscovery({
          opencode: "/tools/opencode",
          codex: "/tools/codex",
          claude: "/tools/claude",
        }),
      )(null),
    );

    expect(config.agentRuntimes.opencode).toMatchObject({
      enabled: true,
      executablePath: "/tools/opencode",
    });
    expect(config.agentRuntimes.codex).toMatchObject({
      enabled: true,
      executablePath: "/tools/codex",
    });
    expect(config.agentRuntimes.claude).toMatchObject({
      enabled: true,
      executablePath: "/tools/claude",
    });
  });

  test("propagates invalid explicit runtime paths", async () => {
    const failure = new HostValidationError({
      field: "OPENDUCKTOR_CODEX_BINARY",
      message: "Configured Codex override points to a missing file.",
    });
    const exit = await Effect.runPromiseExit(
      createRuntimeConfigInitializer(createToolDiscovery({}, { codex: failure }))(null),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Array.from(Cause.failures(exit.cause))).toEqual([failure]);
    }
  });

  test("propagates missing required bundled runtimes as initialization failures", async () => {
    const failure = new HostDependencyError({
      dependency: "opencode",
      operation: "toolDiscovery.discoverTool",
      message: "Bundled OpenCode runtime is missing.",
      details: { requiredSource: true },
    });
    const exit = await Effect.runPromiseExit(
      createRuntimeConfigInitializer(createToolDiscovery({}, { opencode: failure }))(null),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Array.from(Cause.failures(exit.cause))).toEqual([
        expect.objectContaining({
          _tag: "HostOperationError",
          operation: "runtimeConfig.initialize",
          message: failure.message,
          cause: failure,
        }),
      ]);
    }
  });
});
