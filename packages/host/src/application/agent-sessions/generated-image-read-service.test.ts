import { expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createGeneratedImageCommandHandlers } from "../../interface/commands/generated-image-command-handlers";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { createGeneratedImageReadService } from "./generated-image-read-service";

const input = {
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo/worktree",
    externalSessionId: "thread",
  },
  itemId: "image",
  turnId: "turn",
};
const payload = { mime: "image/png" as const, byteLength: 3, base64: "AAAA" };
const binding = { runtimeId: "runtime", runtimeKind: "codex" as const, repoPath: "/repo" };
const definitions = {
  listRuntimeDefinitions: () => [
    {
      ...RUNTIME_DESCRIPTORS_BY_KIND.codex,
      capabilities: {
        ...RUNTIME_DESCRIPTORS_BY_KIND.codex.capabilities,
        optionalSurfaces: {
          ...RUNTIME_DESCRIPTORS_BY_KIND.codex.capabilities.optionalSurfaces,
          supportsImageGeneration: true,
        },
      },
    },
  ],
};

test("reads through the scoped adapter without live snapshot or resume and rejects forged command fields", async () => {
  const registry = createLiveSessionAdapterRegistry();
  const calls: unknown[] = [];
  const source = { representation: "saved_file" as const, path: "/runtime/output.png" };
  await Effect.runPromise(
    registry.register(
      createAgentSessionRuntimeAdapterTestDouble(binding, {
        resolveGeneratedImageSource: (request) =>
          Effect.sync(() => {
            calls.push(request);
            return source;
          }),
      }),
    ),
  );
  const service = createGeneratedImageReadService(
    registry,
    {
      read: (selected, itemId) =>
        Effect.sync(() => {
          calls.push({ selected, itemId });
          return payload;
        }),
    },
    definitions,
  );
  const command = createGeneratedImageCommandHandlers(service).agent_session_read_generated_image;
  expect(await Effect.runPromise(command(input))).toEqual({ ...input, ...payload });
  expect(calls).toEqual([input, { selected: source, itemId: "image" }]);
  for (const forged of [
    { ...input, path: "/secret.png" },
    { ...input, url: "file:///secret.png" },
    { ...input, base64: "AAAA" },
    { ...input, ref: { ...input.ref, path: "/secret.png" } },
  ]) {
    await expect(Effect.runPromise(command(forged))).rejects.toThrow(
      "Paths, URLs, and image bytes are not accepted",
    );
  }
  for (const ref of [
    { ...input.ref, repoPath: "/other" },
    { ...input.ref, runtimeKind: "opencode" as const },
  ]) {
    await expect(Effect.runPromise(service.read({ ...input, ref }))).rejects.toThrow();
  }
  expect(calls).toHaveLength(2);
});

for (const stage of ["source", "file"] as const) {
  test(`runtime replacement during ${stage} read cannot publish bytes`, async () => {
    const registry = createLiveSessionAdapterRegistry();
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const pause = Effect.gen(function* () {
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    });
    const source = { representation: "inline" as const, base64: "AAAA" };
    const adapter = createAgentSessionRuntimeAdapterTestDouble(binding, {
      resolveGeneratedImageSource: () =>
        (stage === "source" ? pause : Effect.void).pipe(Effect.as(source)),
    });
    await Effect.runPromise(registry.register(adapter));
    let fileReads = 0;
    const service = createGeneratedImageReadService(
      registry,
      {
        read: () =>
          Effect.gen(function* () {
            fileReads++;
            if (stage === "file") yield* pause;
            return payload;
          }),
      },
      definitions,
    );
    const fiber = Effect.runFork(service.read(input).pipe(Effect.either));
    await Effect.runPromise(Deferred.await(entered));
    await Effect.runPromise(registry.remove(binding.runtimeId));
    await Effect.runPromise(
      registry.register(createAgentSessionRuntimeAdapterTestDouble(binding, {})),
    );
    await Effect.runPromise(Deferred.succeed(release, undefined));
    const result = await Effect.runPromise(Fiber.join(fiber));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.message).toContain("runtime changed");
    expect(fileReads).toBe(stage === "file" ? 1 : 0);
  });
}

test("unsupported capability prevents source and file reads", async () => {
  const service = createGeneratedImageReadService(
    createLiveSessionAdapterRegistry(),
    { read: () => Effect.dieMessage("unexpected file read") },
    { listRuntimeDefinitions: () => [] },
  );
  await expect(Effect.runPromise(service.read(input))).rejects.toThrow("does not support");
});
