import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createArtifactRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { HostDependencyError } from "../../effect/host-errors";
import type { RuntimeExecutableProbePort } from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
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
  releaseRuntime: () =>
    Effect.sync(() => {
      calls.released += 1;
      return [];
    }),
  createRuntimeRegistration: (binding) =>
    new AgentSessionLiveRegistration(binding, (mutation) =>
      Effect.map(mutation, ({ value }) => value),
    ),
});

const createComposition = (options: {
  calls: { registered: number; released: number; adapters: AgentSessionLiveAdapterPort[] };
  interruptedTurnResumeEnabled?: boolean;
}) => {
  const input: Parameters<typeof createClaudeRuntimeComposition>[0] = {
    interruptedTurnResumeEnabled: options.interruptedTurnResumeEnabled ?? true,
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
    settingsConfig: createFixedRuntimeSettingsConfig("claude", process.execPath),
    toolDiscovery: createToolDiscovery(),
    workingDirectoryDependencies,
  };
  return createClaudeRuntimeComposition(input);
};

const startClaudeRuntime = (composition: ReturnType<typeof createComposition>) =>
  Effect.runPromise(
    composition.workspaceStarter.startWorkspaceRuntime({
      runtimeKind: "claude",
      repoPath: "/repo",
      workingDirectory: "/repo",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
    }),
  );

describe("createClaudeRuntimeComposition", () => {
  test("returns a fully initialized workspace starter without a runtime registry", async () => {
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

  test("disables the adapter continuation when the host gate is off", async () => {
    // SAFETY: The lifecycle stub records the adapters the composition registers.
    const calls = { registered: 0, released: 0, adapters: [] as AgentSessionLiveAdapterPort[] };
    const composition = createComposition({
      calls,
      interruptedTurnResumeEnabled: false,
    });
    const handle = await startClaudeRuntime(composition);
    const adapter = calls.adapters[0];
    if (!adapter || !adapter.supportsSessionControl) {
      throw new Error("Expected a Claude live-session adapter with session control.");
    }

    const failure = await Effect.runPromise(
      adapter
        .continueInterruptedTurn({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          sessionScope: { kind: "repository" },
        })
        .pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(AgentSessionResumeError);
    // SAFETY: The instanceof check above proves the assertion holds.
    expect((failure as AgentSessionResumeError).reason).toBe("unsupported");

    await Effect.runPromise(handle.stop());
  });
});
