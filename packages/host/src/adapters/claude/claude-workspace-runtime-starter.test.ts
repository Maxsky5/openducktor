import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Cause, Chunk, Effect, Exit } from "effect";
import { HostDependencyError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { ClaudeLiveSessionAdapterPreparer } from "../agent-sessions/claude-live-session-adapter";
import { createClaudeWorkspaceRuntimeStarter } from "./claude-workspace-runtime-starter";

const createStartInput = () => ({
  runtimeKind: "claude",
  repoPath: "/repo",
  workingDirectory: "/repo",
  descriptor: structuredClone(RUNTIME_DESCRIPTORS_BY_KIND.claude),
});

const createSystemCommands = (version: string | null = "0.3.191"): SystemCommandPort => ({
  resolveCommandPath() {
    return Effect.succeed(null);
  },
  versionCommand() {
    return Effect.succeed(version);
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: false, stdout: "", stderr: "" });
  },
});

const createToolDiscovery = ({
  claudePath = process.execPath,
}: {
  claudePath?: string | null;
} = {}): ToolDiscoveryPort => ({
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
});

const firstFailure = async <A, E>(effect: Effect.Effect<A, E>): Promise<E | null> => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    return null;
  }
  const failureOption = Chunk.head(Cause.failures(exit.cause));
  return failureOption._tag === "Some" ? failureOption.value : null;
};

const createLiveSessionDependencies = () => {
  const calls = { forwarded: 0, registered: 0, released: 0 };
  const adapter = {} as AgentSessionLiveAdapterPort;
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
  const prepareLiveSessionAdapter: ClaudeLiveSessionAdapterPreparer = () =>
    Effect.succeed({
      adapter,
      startForwarding: () =>
        Effect.sync(() => {
          calls.forwarded += 1;
        }),
      discard: () => Effect.void,
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
      systemCommands: createSystemCommands(),
      toolDiscovery: createToolDiscovery(),
    });

    const handle = await Effect.runPromise(starter.startWorkspaceRuntime(createStartInput()));

    expect(handle.runtime).toMatchObject({
      kind: "claude",
      runtimeId: "runtime-claude",
      runtimeRoute: { type: "host_service", identity: "runtime-claude" },
    });
    expect(liveSession.calls).toEqual({ forwarded: 1, registered: 1, released: 0 });
    await Effect.runPromise(handle.stop());
    expect(liveSession.calls.released).toBe(1);
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
      systemCommands: createSystemCommands(),
      toolDiscovery: createToolDiscovery({ claudePath: null }),
    });

    const failure = await firstFailure(starter.startWorkspaceRuntime(createStartInput()));

    expect(failure).toMatchObject({
      dependency: "claude",
      message: "claude unavailable",
    });
    expect(runtimeIdCalls).toBe(0);
    expect(liveSession.calls).toEqual({ forwarded: 0, registered: 0, released: 0 });
  });
});
