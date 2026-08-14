import { describe, expect, test } from "bun:test";
import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createRuntimeDefinitionsService } from "./runtime-definitions-service";
import { createRuntimeExecutableCheckService } from "./runtime-executable-check-service";

const paths: Record<RuntimeKind, string> = {
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
});
