import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";

const adapter = (runtimeId: string): AgentSessionLiveAdapterPort => ({
  supportsSessionControl: false,
  binding: { runtimeId, runtimeKind: "codex", repoPath: "/repo" },
  listSnapshots: () => Effect.succeed([]),
  readSnapshot: (candidate) => Effect.succeed({ type: "missing", ref: candidate }),
  loadContext: () => Effect.succeed(null),
  replyApproval: () => Effect.void,
  replyQuestion: () => Effect.void,
  releaseRuntime: () => Effect.succeed([]),
});

describe("createLiveSessionAdapterRegistry", () => {
  test("removes only the requested runtime", async () => {
    const registry = createLiveSessionAdapterRegistry();
    const first = adapter("runtime-1");
    const second = {
      ...adapter("runtime-2"),
      binding: { runtimeId: "runtime-2", runtimeKind: "opencode" as const, repoPath: "/repo" },
    };
    await Effect.runPromise(registry.register(first));
    await Effect.runPromise(registry.register(second));

    await expect(Effect.runPromise(registry.remove("runtime-1"))).resolves.toBe(first);
    expect(registry.listForRepo("/repo")).toEqual([second]);
  });

  test("fails session-control resolution when a live-only adapter is registered", async () => {
    const registry = createLiveSessionAdapterRegistry();
    await Effect.runPromise(registry.register(adapter("runtime-1")));

    await expect(
      Effect.runPromise(
        registry.resolveControlForScope({ repoPath: "/repo", runtimeKind: "codex" }),
      ),
    ).rejects.toThrow("does not provide session control");
  });

  test("resolves a unique live adapter by normalized repository/runtime scope", async () => {
    const registry = createLiveSessionAdapterRegistry();
    const first = adapter("runtime-1");
    await Effect.runPromise(registry.register(first));

    await expect(
      Effect.runPromise(registry.resolveForScope({ repoPath: "/repo", runtimeKind: "codex" })),
    ).resolves.toBe(first);
  });

  test("rejects a second runtime for the same repository and runtime kind", async () => {
    const registry = createLiveSessionAdapterRegistry();
    await Effect.runPromise(registry.register(adapter("runtime-1")));

    await expect(Effect.runPromise(registry.register(adapter("runtime-2")))).rejects.toThrow(
      "already has a codex live runtime",
    );
  });
});
