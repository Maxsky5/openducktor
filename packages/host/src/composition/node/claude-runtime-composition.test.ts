import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createArtifactRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { HostDependencyError } from "../../effect/host-errors";
import type { RuntimeExecutableProbePort } from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createClaudeRuntimeComposition } from "./claude-runtime-composition";

const runtimeExecutableProbe: RuntimeExecutableProbePort = {
  probeExecutable: () => Effect.void,
};

const createToolDiscovery = (): ToolDiscoveryPort => ({
  discoverTool(toolId) {
    return this.resolveTool(toolId);
  },
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
  validateToolPath(toolId, executablePath) {
    return toolId === "claude" && executablePath === process.execPath
      ? Effect.succeed({
          displayLabel: "Saved path",
          path: executablePath,
          sourceCategory: "provided_path",
        })
      : Effect.fail(
          new HostDependencyError({ dependency: toolId, message: `${toolId} unavailable` }),
        );
  },
});

const workingDirectoryDependencies = {
  gitPort: {
    isRegisteredWorktree: () => Effect.succeed(false),
  },
  settingsConfig: {
    canonicalizePath: (path: string) => Effect.succeed(path),
    defaultRepoWorktreeBasePath: () => "/legacy-worktrees/repo",
    defaultWorktreeBasePath: () => "/worktrees/repo",
    resolveConfiguredPath: (path: string) => path,
  },
  workspaceSettingsService: {
    getRepoConfigByRepoPath: () =>
      Effect.succeed(
        repoConfigSchema.parse({
          workspaceId: "repo",
          worktreeBasePath: "/worktrees/repo",
        }),
      ),
  },
};

const createLiveSessionLifecycle = (calls: {
  registered: number;
  released: number;
  adapters: AgentSessionLiveAdapterPort[];
}): RuntimeLiveSessionLifecyclePort => ({
  registerRuntimeAdapter: (adapter) =>
    Effect.sync(() => {
      calls.registered += 1;
      calls.adapters.push(adapter);
    }),
  releaseRuntime: (runtimeId) =>
    Effect.suspend(() => {
      calls.released += 1;
      const adapter = calls.adapters.find((entry) => entry.binding.runtimeId === runtimeId);
      return adapter ? adapter.releaseRuntime() : Effect.succeed([]);
    }),
  createRuntimeRegistration: (binding) =>
    new AgentSessionLiveRegistration(binding, (mutation) =>
      Effect.map(mutation, ({ value }) => value),
    ),
});

const createComposition = (options: {
  calls: { registered: number; released: number; adapters: AgentSessionLiveAdapterPort[] };
}) => {
  const input: Parameters<typeof createClaudeRuntimeComposition>[0] = {
    liveSessionLifecycle: createLiveSessionLifecycle(options.calls),
    onBackgroundFailure: () => Effect.void,
    resolveMcpBridgeConnection: () =>
      Effect.succeed({
        workspaceId: "workspace-1",
        hostUrl: "http://127.0.0.1:5000",
        hostToken: "test-token",
      }),
    runtimeExecutableProbe,
    runtimeDistribution: createArtifactRuntimeDistribution({
      mcpLauncher: { kind: "executable", executablePath: process.execPath },
    }),
    launchPolicy: {
      resolve: () => Effect.succeed({}),
    },
    toolDiscovery: createToolDiscovery(),
    workingDirectoryDependencies,
  };
  return createClaudeRuntimeComposition(input);
};

const startClaudeRuntime = (composition: ReturnType<typeof createComposition>) =>
  Effect.runPromise(
    composition.runtimeStarter.startRuntime({
      runtimeKind: "claude",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
      configuredExecutablePath: process.execPath,
      ownCleanup: () => undefined,
      onRuntimeExit: () => {
        throw new Error("Claude has no managed process exit.");
      },
      onRuntimeCleanupFailed: () => {
        throw new Error("Claude has no managed process exit.");
      },
    }),
  );

describe("createClaudeRuntimeComposition", () => {
  test("returns a fully initialized runtime starter without a runtime registry", async () => {
    // SAFETY: The lifecycle stub records the adapters the composition registers.
    const calls = { registered: 0, released: 0, adapters: [] as AgentSessionLiveAdapterPort[] };
    const composition = createComposition({ calls });

    const handle = await startClaudeRuntime(composition);

    expect(handle.runtime).toMatchObject({
      kind: "claude",
      runtimeRoute: { type: "host_service", identity: handle.runtime.runtimeId },
    });
    expect({ registered: calls.registered, released: calls.released }).toEqual({
      registered: 1,
      released: 0,
    });

    await Effect.runPromise(handle.stop());
    expect(calls.released).toBe(1);
  });

  test("replaces the host-wide Claude service when the runtime restarts", async () => {
    // SAFETY: The lifecycle stub records the adapters the composition registers.
    const calls = { registered: 0, released: 0, adapters: [] as AgentSessionLiveAdapterPort[] };
    const composition = createComposition({ calls });

    const first = await startClaudeRuntime(composition);
    await Effect.runPromise(first.stop());
    const replacement = await startClaudeRuntime(composition);

    expect(replacement.runtime.runtimeId).not.toBe(first.runtime.runtimeId);
    expect(calls.adapters.map((adapter) => adapter.binding.runtimeId)).toEqual([
      first.runtime.runtimeId,
      replacement.runtime.runtimeId,
    ]);
    await Effect.runPromise(replacement.stop());
    expect(calls.released).toBe(2);
  });
});
