import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Cause, Chunk, Effect, Exit } from "effect";
import { HostDependencyError, HostOperationError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbePort,
} from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import type { ClaudeLiveSessionAdapterPreparer } from "../agent-sessions/claude-live-session-adapter-contract";
import { createClaudeWorkspaceRuntimeStarter } from "./claude-workspace-runtime-starter";

const createStartInput = () => ({
  runtimeKind: "claude",
  repoPath: "/repo",
  workingDirectory: "/repo",
  descriptor: structuredClone(RUNTIME_DESCRIPTORS_BY_KIND.claude),
});

const successfulRuntimeExecutableProbe: RuntimeExecutableProbePort = {
  probeExecutable: () => Effect.void,
};

const createToolDiscovery = ({
  claudePath = process.execPath,
}: {
  claudePath?: string | null;
} = {}): ToolDiscoveryPort => ({
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
    if (toolId === "claude" && claudePath) {
      return Effect.succeed(claudePath);
    }
    return Effect.fail(
      new HostDependencyError({
        dependency: toolId,
        message: `${toolId} unavailable`,
      }),
    );
  },
  validateToolPath(toolId, executablePath) {
    if (toolId === "claude" && claudePath === executablePath) {
      return Effect.succeed({
        displayLabel: "Saved path",
        path: executablePath,
        sourceCategory: "provided_path",
      });
    }
    return Effect.fail(
      new HostDependencyError({
        dependency: toolId,
        message: `${toolId} unavailable`,
      }),
    );
  },
});

const createRuntimePathDependencies = (claudePath: string | null = process.execPath) => ({
  settingsConfig: createFixedRuntimeSettingsConfig("claude", claudePath ?? "/missing/claude"),
  toolDiscovery: createToolDiscovery({ claudePath }),
});

const firstFailure = async <A, E>(effect: Effect.Effect<A, E>): Promise<E | null> => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    return null;
  }
  const failureOption = Chunk.head(Cause.failures(exit.cause));
  return failureOption._tag === "Some" ? failureOption.value : null;
};

const createLiveSessionDependencies = ({
  releaseFailures = 0,
}: {
  releaseFailures?: number;
} = {}) => {
  const calls = { discarded: 0, forwarded: 0, registered: 0, released: 0 };
  let remainingReleaseFailures = releaseFailures;
  const adapter: AgentSessionLiveAdapterPort = {
    supportsSessionControl: false,
    binding: { runtimeId: "runtime-1", runtimeKind: "claude", repoPath: "/repo" },
    listSnapshots: () => Effect.succeed([]),
    readSnapshot: () => Effect.die("unused"),
    loadContext: () => Effect.die("unused"),
    replyApproval: () => Effect.die("unused"),
    replyQuestion: () => Effect.die("unused"),
    releaseRuntime: () => Effect.succeed([]),
  };
  const liveSessionLifecycle: RuntimeLiveSessionLifecyclePort = {
    registerRuntimeAdapter: () =>
      Effect.sync(() => {
        calls.registered += 1;
      }),
    releaseRuntime: () =>
      Effect.suspend(() => {
        calls.released += 1;
        if (remainingReleaseFailures > 0) {
          remainingReleaseFailures -= 1;
          return Effect.fail(
            new HostOperationError({
              operation: "test.release-runtime",
              message: "Claude cleanup failed.",
            }),
          );
        }
        return Effect.succeed([]);
      }),
    runAdapterMutation: (mutation) => Effect.map(mutation, ({ value }) => value),
  };
  const prepareLiveSessionAdapter: ClaudeLiveSessionAdapterPreparer = () =>
    Effect.succeed({
      adapter,
      startForwarding: () =>
        Effect.sync(() => {
          calls.forwarded += 1;
        }),
      discard: () =>
        Effect.sync(() => {
          calls.discarded += 1;
        }),
    });
  return { calls, liveSessionLifecycle, prepareLiveSessionAdapter };
};

describe("createClaudeWorkspaceRuntimeStarter", () => {
  test("validates Claude startup dependencies before returning a runtime", async () => {
    const liveSession = createLiveSessionDependencies();
    const starter = createClaudeWorkspaceRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => "runtime-claude",
      runtimeExecutableProbe: successfulRuntimeExecutableProbe,
      ...createRuntimePathDependencies(),
    });

    const handle = await Effect.runPromise(starter.startWorkspaceRuntime(createStartInput()));

    expect(handle.runtime).toMatchObject({
      kind: "claude",
      runtimeId: "runtime-claude",
      runtimeRoute: { type: "host_service", identity: "runtime-claude" },
    });
    expect(liveSession.calls).toEqual({
      discarded: 0,
      forwarded: 1,
      registered: 1,
      released: 0,
    });
    await Effect.runPromise(handle.stop());
    expect(liveSession.calls.released).toBe(1);
  });

  test("probes the exact saved executable before returning a runtime", async () => {
    const liveSession = createLiveSessionDependencies();
    const probeCalls: string[] = [];
    const starter = createClaudeWorkspaceRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => "runtime-claude",
      runtimeExecutableProbe: {
        probeExecutable(executablePath) {
          probeCalls.push(executablePath);
          return Effect.void;
        },
      },
      ...createRuntimePathDependencies(),
    });

    const handle = await Effect.runPromise(starter.startWorkspaceRuntime(createStartInput()));

    expect(probeCalls).toEqual([process.execPath]);
    await Effect.runPromise(handle.stop());
  });

  test("retries adapter cleanup after a registered release fails", async () => {
    const liveSession = createLiveSessionDependencies({ releaseFailures: 1 });
    const starter = createClaudeWorkspaceRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => "runtime-claude",
      runtimeExecutableProbe: successfulRuntimeExecutableProbe,
      ...createRuntimePathDependencies(),
    });
    const handle = await Effect.runPromise(starter.startWorkspaceRuntime(createStartInput()));

    await expect(Effect.runPromise(handle.stop())).rejects.toThrow("Claude cleanup failed.");
    expect(handle.isAlive()).toBe(false);
    await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    expect(liveSession.calls).toMatchObject({ discarded: 1, released: 1 });
  });

  test("fails readiness before allocating a runtime id when Claude is missing", async () => {
    let runtimeIdCalls = 0;
    const liveSession = createLiveSessionDependencies();
    const starter = createClaudeWorkspaceRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => {
        runtimeIdCalls += 1;
        return "runtime-claude";
      },
      runtimeExecutableProbe: successfulRuntimeExecutableProbe,
      ...createRuntimePathDependencies(null),
    });

    const failure = await firstFailure(starter.startWorkspaceRuntime(createStartInput()));

    expect(failure).toMatchObject({
      dependency: "claude",
      message: "claude unavailable",
    });
    expect(runtimeIdCalls).toBe(0);
    expect(liveSession.calls).toEqual({
      discarded: 0,
      forwarded: 0,
      registered: 0,
      released: 0,
    });
  });

  test("rejects a non-Claude executable before allocating a runtime id", async () => {
    let runtimeIdCalls = 0;
    const liveSession = createLiveSessionDependencies();
    const starter = createClaudeWorkspaceRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => {
        runtimeIdCalls += 1;
        return "runtime-claude";
      },
      runtimeExecutableProbe: {
        probeExecutable(executablePath) {
          return Effect.fail(
            new RuntimeExecutableIncompatibleError({
              message: `Selected executable does not speak the Claude Agent SDK protocol: ${executablePath}`,
            }),
          );
        },
      },
      ...createRuntimePathDependencies(),
    });

    const failure = await firstFailure(starter.startWorkspaceRuntime(createStartInput()));

    expect(failure).toMatchObject({
      _tag: "HostValidationError",
      field: "agentRuntimes.claude.executablePath",
      message: `Selected executable does not speak the Claude Agent SDK protocol: ${process.execPath}`,
    });
    expect(runtimeIdCalls).toBe(0);
    expect(liveSession.calls).toEqual({
      discarded: 0,
      forwarded: 0,
      registered: 0,
      released: 0,
    });
  });
});
