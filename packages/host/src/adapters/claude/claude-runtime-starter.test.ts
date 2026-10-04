import { unexpectedSessionImport } from "../../test-support/session-import-test-doubles";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
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
import type { RuntimeStartInput } from "../../ports/runtime-registry-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { ClaudeLiveSessionAdapterPreparer } from "../agent-sessions/claude-live-session-adapter-contract";
import { createClaudeRuntimeStarter } from "./claude-runtime-starter";

const createStartInput = (configuredExecutablePath = process.execPath): RuntimeStartInput => ({
  runtimeKind: "claude",
  descriptor: structuredClone(RUNTIME_DESCRIPTORS_BY_KIND.claude),
  configuredExecutablePath,
  ownCleanup: () => undefined,
  onRuntimeExit: () => {
    throw new Error("Claude has no managed process exit.");
  },
  onRuntimeCleanupFailed: () => {
    throw new Error("Claude has no managed process exit.");
  },
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
  const executablePaths: string[] = [];
  let remainingReleaseFailures = releaseFailures;
  const adapter: AgentSessionLiveAdapterPort = {
    queries: unexpectedRuntimeQueries,
    sessionImport: unexpectedSessionImport,
    supportsSessionControl: false,
    beginGeneratedImageBatch: () => Effect.dieMessage("Unexpected beginGeneratedImageBatch"),
    releaseGeneratedImageBatch: () => Effect.dieMessage("Unexpected releaseGeneratedImageBatch"),
    describeGeneratedImages: () => Effect.dieMessage("Unexpected describeGeneratedImages"),
    resolveGeneratedImageSource: () => Effect.dieMessage("Unexpected generated image read"),
    binding: new AgentSessionLiveRegistration(
      { runtimeId: "runtime-1", runtimeKind: "claude" },
      (mutation) => Effect.map(mutation, ({ value }) => value),
    ),
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
    createRuntimeRegistration: (binding) =>
      new AgentSessionLiveRegistration(binding, (mutation) =>
        Effect.map(mutation, ({ value }) => value),
      ),
  };
  const prepareLiveSessionAdapter: ClaudeLiveSessionAdapterPreparer = (_runtime, executablePath) =>
    Effect.sync(() => {
      executablePaths.push(executablePath);
      return {
        adapter,
        startForwarding: () =>
          Effect.sync(() => {
            calls.forwarded += 1;
          }),
        discard: () =>
          Effect.sync(() => {
            calls.discarded += 1;
          }),
      };
    });
  return { calls, executablePaths, liveSessionLifecycle, prepareLiveSessionAdapter };
};

describe("createClaudeRuntimeStarter", () => {
  test("validates Claude startup dependencies before returning a runtime", async () => {
    const liveSession = createLiveSessionDependencies();
    const starter = createClaudeRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => "runtime-claude",
      runtimeExecutableProbe: successfulRuntimeExecutableProbe,
      ...createRuntimePathDependencies(),
    });

    const handle = await Effect.runPromise(starter.startRuntime(createStartInput()));

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

  test("returns a host-wide runtime summary without repository fields", async () => {
    const liveSession = createLiveSessionDependencies();
    const starter = createClaudeRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => "runtime-claude",
      runtimeExecutableProbe: successfulRuntimeExecutableProbe,
      ...createRuntimePathDependencies(),
    });

    const handle = await Effect.runPromise(starter.startRuntime(createStartInput()));

    expect(handle.runtime).toEqual({
      kind: "claude",
      runtimeId: "runtime-claude",
      runtimeRoute: { type: "host_service", identity: "runtime-claude" },
      startedAt: "2026-01-02T03:04:05.000Z",
      descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
    });
    expect(handle.configuredExecutablePath).toBe(process.execPath);
    expect(handle.effectiveExecutablePath).toBe(process.execPath);
    await Effect.runPromise(handle.stop());
  });

  test("starts a replacement runtime with the newly selected executable", async () => {
    const liveSession = createLiveSessionDependencies();
    const replacementPath = `${process.execPath}-replacement`;
    const probeCalls: string[] = [];
    const runtimeIds = ["runtime-claude-1", "runtime-claude-2"];
    const starter = createClaudeRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => runtimeIds.shift() ?? "unexpected-runtime",
      runtimeExecutableProbe: {
        probeExecutable(executablePath) {
          probeCalls.push(executablePath);
          return Effect.void;
        },
      },
      toolDiscovery: {
        ...createToolDiscovery(),
        validateToolPath: (_toolId, executablePath) =>
          Effect.succeed({
            displayLabel: "Saved path",
            path: executablePath,
            sourceCategory: "provided_path" as const,
          }),
      },
    });

    const first = await Effect.runPromise(starter.startRuntime(createStartInput()));
    await Effect.runPromise(first.stop());
    const replacement = await Effect.runPromise(
      starter.startRuntime(createStartInput(replacementPath)),
    );

    expect(probeCalls).toEqual([process.execPath, replacementPath]);
    expect(liveSession.executablePaths).toEqual([process.execPath, replacementPath]);
    expect(replacement.runtime.runtimeId).toBe("runtime-claude-2");
    expect(replacement.configuredExecutablePath).toBe(replacementPath);
    expect(replacement.effectiveExecutablePath).toBe(replacementPath);
    await Effect.runPromise(replacement.stop());
  });

  test("probes the exact saved executable before returning a runtime", async () => {
    const liveSession = createLiveSessionDependencies();
    const probeCalls: string[] = [];
    const starter = createClaudeRuntimeStarter({
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

    const handle = await Effect.runPromise(starter.startRuntime(createStartInput()));

    expect(probeCalls).toEqual([process.execPath]);
    expect(liveSession.executablePaths).toEqual([process.execPath]);
    await Effect.runPromise(handle.stop());
  });

  test("retries adapter cleanup after a registered release fails", async () => {
    const liveSession = createLiveSessionDependencies({ releaseFailures: 1 });
    const starter = createClaudeRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => "runtime-claude",
      runtimeExecutableProbe: successfulRuntimeExecutableProbe,
      ...createRuntimePathDependencies(),
    });
    const handle = await Effect.runPromise(starter.startRuntime(createStartInput()));

    await expect(Effect.runPromise(handle.stop())).rejects.toThrow("Claude cleanup failed.");
    await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    // The retry repeats the failed release; it never falls back to discarding the adapter.
    expect(liveSession.calls).toMatchObject({ discarded: 0, released: 2 });
  });

  test("fails readiness before allocating a runtime id when Claude is missing", async () => {
    let runtimeIdCalls = 0;
    const liveSession = createLiveSessionDependencies();
    const starter = createClaudeRuntimeStarter({
      liveSessionLifecycle: liveSession.liveSessionLifecycle,
      prepareLiveSessionAdapter: liveSession.prepareLiveSessionAdapter,
      runtimeId: () => {
        runtimeIdCalls += 1;
        return "runtime-claude";
      },
      runtimeExecutableProbe: successfulRuntimeExecutableProbe,
      ...createRuntimePathDependencies(null),
    });

    const failure = await firstFailure(starter.startRuntime(createStartInput("/missing/claude")));

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
    const starter = createClaudeRuntimeStarter({
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

    const failure = await firstFailure(starter.startRuntime(createStartInput()));

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
