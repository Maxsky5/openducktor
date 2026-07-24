import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { createArtifactRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { HostDependencyError } from "../../effect/host-errors";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createClaudeRuntimeComposition } from "./claude-runtime-composition";

const createSystemCommands = (): SystemCommandPort => ({
  resolveCommandPath: () => Effect.succeed(null),
  runCommandAllowFailure: () => Effect.succeed({ ok: false, stdout: "", stderr: "" }),
  versionCommand: () => Effect.succeed("0.3.191"),
});

const createToolDiscovery = (): ToolDiscoveryPort => ({
  resolveTool(toolId) {
    return this.resolveToolPath(toolId).pipe(
      Effect.map((path) => ({
        displayLabel: "Test tool",
        path,
        sourceCategory: "provided_path" as const,
      })),
    );
  },
  resolveToolPath(toolId) {
    if (toolId === "claude") {
      return Effect.succeed(process.execPath);
    }
    return Effect.fail(
      new HostDependencyError({
        dependency: toolId,
        message: `${toolId} unavailable`,
      }),
    );
  },
});

describe("createClaudeRuntimeComposition", () => {
  test("returns a fully initialized workspace starter without a runtime registry", async () => {
    const calls = { registered: 0, released: 0 };
    const liveSessionLifecycle: RuntimeLiveSessionLifecyclePort = {
      registerRuntimeAdapter: () =>
        Effect.sync(() => {
          calls.registered += 1;
        }),
      releaseRuntime: () =>
        Effect.sync(() => {
          calls.released += 1;
          return [];
        }),
      runAdapterMutation: (mutation) => Effect.map(mutation, ({ value }) => value),
    };
    const composition = createClaudeRuntimeComposition({
      liveSessionLifecycle,
      onBackgroundFailure: () => Effect.void,
      resolveMcpBridgeConnection: () =>
        Effect.succeed({
          workspaceId: "workspace-1",
          hostUrl: "http://127.0.0.1:5000",
          hostToken: "test-token",
        }),
      runtimeDistribution: createArtifactRuntimeDistribution({
        mcpLauncher: { kind: "executable", executablePath: process.execPath },
      }),
      systemCommands: createSystemCommands(),
      toolDiscovery: createToolDiscovery(),
    });

    const handle = await Effect.runPromise(
      composition.workspaceStarter.startWorkspaceRuntime({
        runtimeKind: "claude",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
      }),
    );

    expect(handle.runtime).toMatchObject({
      kind: "claude",
      runtimeRoute: { type: "host_service", identity: handle.runtime.runtimeId },
    });
    expect(calls).toEqual({ registered: 1, released: 0 });

    await Effect.runPromise(handle.stop());
    expect(calls.released).toBe(1);
  });
});
