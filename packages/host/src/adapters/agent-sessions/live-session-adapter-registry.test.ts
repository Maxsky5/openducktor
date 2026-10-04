import { unexpectedSessionImport } from "../../test-support/session-import-test-doubles";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import { describe, expect, test } from "bun:test";
import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";

const adapter = (
  runtimeId: string,
  runtimeKind: RuntimeKind = "codex",
): AgentSessionLiveAdapterPort => ({
  queries: unexpectedRuntimeQueries,
  sessionImport: unexpectedSessionImport,
  supportsSessionControl: false,
  beginGeneratedImageBatch: () => Effect.dieMessage("Unexpected beginGeneratedImageBatch"),
  releaseGeneratedImageBatch: () => Effect.dieMessage("Unexpected releaseGeneratedImageBatch"),
  describeGeneratedImages: () => Effect.dieMessage("Unexpected describeGeneratedImages"),
  resolveGeneratedImageSource: () => Effect.dieMessage("Unexpected generated image read"),
  binding: new AgentSessionLiveRegistration({ runtimeId, runtimeKind }, (mutation) =>
    Effect.map(mutation, ({ value }) => value),
  ),
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
    const second = adapter("runtime-2", "opencode");
    await Effect.runPromise(registry.register(first));
    await Effect.runPromise(registry.register(second));

    await expect(Effect.runPromise(registry.remove("runtime-1"))).resolves.toBe(first);
    expect(registry.list()).toEqual([second]);
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

  test("resolves the shared adapter of a kind for every repository", async () => {
    const registry = createLiveSessionAdapterRegistry();
    const first = adapter("runtime-1");
    await Effect.runPromise(registry.register(first));

    await expect(
      Effect.runPromise(registry.resolveForScope({ repoPath: "/repo", runtimeKind: "codex" })),
    ).resolves.toBe(first);
    await expect(
      Effect.runPromise(
        registry.resolveForScope({ repoPath: "/other-repo", runtimeKind: "codex" }),
      ),
    ).resolves.toBe(first);
  });

  test("fails resolution with an actionable message when no adapter of the kind is registered", async () => {
    const registry = createLiveSessionAdapterRegistry();
    await Effect.runPromise(registry.register(adapter("runtime-1", "opencode")));

    await expect(
      Effect.runPromise(registry.resolveForScope({ repoPath: "/repo", runtimeKind: "codex" })),
    ).rejects.toThrow(
      "The codex runtime is not running. Check Diagnostics, then restart the runtime.",
    );
  });

  test("rejects a second runtime of the same kind", async () => {
    const registry = createLiveSessionAdapterRegistry();
    const first = adapter("runtime-1");
    await Effect.runPromise(registry.register(first));

    await expect(Effect.runPromise(registry.register(adapter("runtime-2")))).rejects.toThrow(
      "A codex live runtime is already registered.",
    );
    expect(registry.list()).toEqual([first]);
  });

  test("rejects a second registration of the same runtime id", async () => {
    const registry = createLiveSessionAdapterRegistry();
    await Effect.runPromise(registry.register(adapter("runtime-1")));

    await expect(
      Effect.runPromise(registry.register(adapter("runtime-1", "opencode"))),
    ).rejects.toThrow("Live-session adapter is already registered for runtime 'runtime-1'.");
  });

  test("accepts a replacement of the same kind after the old runtime is removed", async () => {
    const registry = createLiveSessionAdapterRegistry();
    await Effect.runPromise(registry.register(adapter("runtime-1")));
    await Effect.runPromise(registry.remove("runtime-1"));
    const replacement = adapter("runtime-2");

    await Effect.runPromise(registry.register(replacement));

    expect(registry.list()).toEqual([replacement]);
  });
});
