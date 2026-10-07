import { expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createGeneratedImageCommandHandlers } from "../../interface/commands/generated-image-command-handlers";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { createGeneratedImageReadService } from "./generated-image-read-service";
import { HostValidationError } from "../../effect/host-errors";

const input = {
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo/worktree",
    externalSessionId: "thread",
  },
  itemId: "image",
  revision: "output-v1",
  turnId: "turn",
};
const payload = { mime: "image/png" as const, byteLength: 3, base64: "AAAA" };
const binding = { runtimeId: "runtime", runtimeKind: "codex" as const };
const codexImageDefinition = {
  ...RUNTIME_DESCRIPTORS_BY_KIND.codex,
  capabilities: {
    ...RUNTIME_DESCRIPTORS_BY_KIND.codex.capabilities,
    optionalSurfaces: {
      ...RUNTIME_DESCRIPTORS_BY_KIND.codex.capabilities.optionalSurfaces,
      supportsImageGeneration: true,
    },
  },
};
const definitions = {
  listRuntimeDefinitions: () => [codexImageDefinition],
};
const requireRepoScope = (ref: { repoPath: string }) =>
  ref.repoPath === input.ref.repoPath
    ? Effect.void
    : Effect.fail(
        new HostValidationError({
          field: "workingDirectory",
          message: "The session is outside the selected workspace.",
        }),
      );

test("reads through the scoped adapter without live snapshot or resume and rejects forged command fields", async () => {
  const registry = createLiveSessionAdapterRegistry();
  const calls: unknown[] = [];
  const source = {
    representation: "saved_file" as const,
    revision: input.revision,
    path: "/runtime/output.png",
  };
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
    requireRepoScope,
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
      requireRepoScope,
    );
    const fiber = Effect.runFork(service.read(input).pipe(Effect.result));
    await Effect.runPromise(Deferred.await(entered));
    await Effect.runPromise(registry.remove(binding.runtimeId));
    await Effect.runPromise(
      registry.register(createAgentSessionRuntimeAdapterTestDouble(binding, {})),
    );
    await Effect.runPromise(Deferred.succeed(release, undefined));
    const result = await Effect.runPromise(Fiber.join(fiber));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.message).toContain("runtime changed");
    expect(fileReads).toBe(stage === "file" ? 1 : 0);
  });
}

test("unsupported capability prevents source and file reads", async () => {
  const service = createGeneratedImageReadService(
    createLiveSessionAdapterRegistry(),
    { read: () => Effect.die(new Error("unexpected file read")) },
    {
      listRuntimeDefinitions: () => [],
    },
    requireRepoScope,
  );
  await expect(Effect.runPromise(service.read(input))).rejects.toThrow("does not support");
});

test("a rejected output revision prevents file reads", async () => {
  const registry = createLiveSessionAdapterRegistry();
  const rejected = new HostValidationError({ field: "revision", message: "output changed" });
  const requests: unknown[] = [];
  await Effect.runPromise(
    registry.register(
      createAgentSessionRuntimeAdapterTestDouble(binding, {
        resolveGeneratedImageSource: (request) => {
          requests.push(request);
          return Effect.fail(rejected);
        },
      }),
    ),
  );
  let fileReads = 0;
  const service = createGeneratedImageReadService(
    registry,
    {
      read: () =>
        Effect.sync(() => {
          fileReads++;
          return payload;
        }),
    },
    definitions,
    requireRepoScope,
  );
  const result = await Effect.runPromise(Effect.result(service.read(input)));
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure).toBe(rejected);
  expect(requests).toEqual([input]);
  expect(fileReads).toBe(0);
});

test("batch and metadata commands reject file paths, oversized batches, and invalid batch IDs", async () => {
  const service = createGeneratedImageReadService(
    createLiveSessionAdapterRegistry(),
    {
      read: () => Effect.die(new Error("Unexpected file read")),
    },
    definitions,
    requireRepoScope,
  );
  const commands = createGeneratedImageCommandHandlers(service);
  for (const request of [
    { ref: input.ref, images: [{ itemId: "image", path: "/private/file" }] },
    { ref: input.ref, images: [{ itemId: "image" }], path: "/private/file" },
  ])
    await expect(
      Effect.runPromise(commands.agent_session_describe_generated_images(request)),
    ).rejects.toThrow("exact session and image identity");
  await expect(
    Effect.runPromise(
      commands.agent_session_begin_generated_image_batch({
        ref: input.ref,
        images: Array.from({ length: 9 }, (_, index) => ({
          itemId: `image-${index}`,
          revision: "digest",
        })),
      }),
    ),
  ).rejects.toThrow("exact session and image identity");
  await expect(
    Effect.runPromise(
      commands.agent_session_release_generated_image_batch({ ref: input.ref, batchId: "invalid" }),
    ),
  ).rejects.toThrow("exact session and image identity");
});
