import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";

const ref = (externalSessionId: string): AgentSessionLiveRef => ({
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  externalSessionId,
});

const adapter = (runtimeId: string, sessionIds: string[]): AgentSessionLiveAdapterPort => ({
  binding: { runtimeId, runtimeKind: "codex", repoPath: "/repo" },
  matches: (candidate) => sessionIds.includes(candidate.externalSessionId),
  listRetainedSnapshots: () => Effect.succeed([]),
  readRetainedSnapshot: (candidate) => Effect.succeed({ type: "missing", ref: candidate }),
  loadContext: () => Effect.succeed(null),
  replyApproval: () => Effect.void,
  replyQuestion: () => Effect.void,
  releaseRuntime: () => Effect.succeed([]),
});

describe("createLiveSessionAdapterRegistry", () => {
  test("resolves private runtime ownership without adding runtimeId to the public ref", async () => {
    const registry = createLiveSessionAdapterRegistry();
    const first = adapter("runtime-1", ["session-1"]);
    const second = adapter("runtime-2", ["session-2"]);
    await Effect.runPromise(registry.register(first));
    await Effect.runPromise(registry.register(second));

    await expect(Effect.runPromise(registry.resolve(ref("session-2")))).resolves.toBe(second);
  });

  test("fails closed when two runtime adapters claim the same session ref", async () => {
    const registry = createLiveSessionAdapterRegistry();
    await Effect.runPromise(registry.register(adapter("runtime-1", ["session-1"])));
    await Effect.runPromise(registry.register(adapter("runtime-2", ["session-1"])));

    await expect(Effect.runPromise(registry.resolve(ref("session-1")))).rejects.toThrow(
      "Multiple live runtimes claim session",
    );
  });

  test("removes only the requested runtime", async () => {
    const registry = createLiveSessionAdapterRegistry();
    const first = adapter("runtime-1", ["session-1"]);
    const second = adapter("runtime-2", ["session-2"]);
    await Effect.runPromise(registry.register(first));
    await Effect.runPromise(registry.register(second));

    await expect(Effect.runPromise(registry.remove("runtime-1"))).resolves.toBe(first);
    expect(registry.listForRepo("/repo")).toEqual([second]);
  });

  test("fails session-control resolution when a live-only adapter is registered", async () => {
    const registry = createLiveSessionAdapterRegistry();
    await Effect.runPromise(registry.register(adapter("runtime-1", ["session-1"])));

    await expect(Effect.runPromise(registry.resolveControl(ref("session-1")))).rejects.toThrow(
      "does not provide session control",
    );
  });

  test("resolves a unique live adapter by normalized repository/runtime scope", async () => {
    const registry = createLiveSessionAdapterRegistry();
    const first = adapter("runtime-1", []);
    await Effect.runPromise(registry.register(first));

    await expect(
      Effect.runPromise(registry.resolveForScope({ repoPath: "/repo", runtimeKind: "codex" })),
    ).resolves.toBe(first);
  });

  test("fails closed when repository/runtime scope matches multiple live adapters", async () => {
    const registry = createLiveSessionAdapterRegistry();
    await Effect.runPromise(registry.register(adapter("runtime-1", ["session-1"])));
    await Effect.runPromise(registry.register(adapter("runtime-2", ["session-2"])));

    await expect(
      Effect.runPromise(registry.resolveForScope({ repoPath: "/repo", runtimeKind: "codex" })),
    ).rejects.toThrow("Multiple live runtimes match");
  });
});
