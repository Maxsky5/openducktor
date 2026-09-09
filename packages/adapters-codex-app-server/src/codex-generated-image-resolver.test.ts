import { expect, test, mock } from "bun:test";
import type { CodexAppServerThreadItem } from "@openducktor/contracts";
import {
  codexImageGenerationPart,
  type CodexImageGenerationItem,
  type CodexImageGenerationPreparer,
} from "./codex-image-generation";
import {
  codexThreadFixture,
  codexTurnFixture,
  createDeferred,
  createHarness,
  RecordingTransport,
  makeRuntimeSummary,
} from "./codex-app-server-adapter.test-harness";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "thread-image",
};
const completed = (): CodexImageGenerationItem => ({
  type: "imageGeneration",
  id: "image",
  status: "completed",
  result: "aW1hZ2U=",
  revisedPrompt: null,
  transparentBackground: null,
  failure: null,
});
const createImageHarness = (
  items: CodexAppServerThreadItem[] = [completed()],
  cwd = "/repo",
  threadId = ref.externalSessionId,
  prepareImageGenerations?: CodexImageGenerationPreparer,
) => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const gate = createDeferred<void>();
  const historyStarted = createDeferred<void>();
  let deferred = false;
  const options: Parameters<typeof createHarness>[0] = {
    transportFactory: (runtimeId) => {
      const transport = new RecordingTransport(runtimeId, false);
      return {
        request: async (request) => {
          calls.push({ method: request.method, params: request.params });
          if (request.method === "thread/read")
            return { thread: codexThreadFixture({ id: threadId, cwd, status: { type: "idle" } }) };
          if (request.method === "thread/turns/list") {
            historyStarted.resolve();
            if (deferred) await gate.promise;
            return {
              data: [codexTurnFixture({ id: "turn", status: "completed", items })],
              nextCursor: null,
              backwardsCursor: null,
            };
          }
          return transport.request(request);
        },
      };
    },
  };
  if (prepareImageGenerations) options.prepareImageGenerations = prepareImageGenerations;
  const { adapter } = createHarness(options);
  return {
    adapter,
    calls,
    gate,
    historyStarted,
    defer: () => {
      deferred = true;
    },
  };
};

test("source lookup uses full public history without a live snapshot or resume", async () => {
  const native = { ...completed(), savedPath: "/generated/image.png" };
  const harness = createImageHarness([native]);
  await harness.adapter.prepareRuntime("runtime-live");
  try {
    expect(
      await harness.adapter.resolveGeneratedImageSource({
        ref,
        itemId: "image",
        turnId: "turn",
        revision:
          native.savedPath !== undefined
            ? "file-digest"
            : codexImageGenerationPart(native).output!.revision,
      }),
    ).toEqual({
      representation: "saved_file",
      path: "/generated/image.png",
      revision: "file-digest",
    });
    expect(harness.calls.filter((call) => call.method !== "initialize")).toEqual([
      { method: "thread/read", params: { threadId: ref.externalSessionId, includeTurns: false } },
      {
        method: "thread/turns/list",
        params: {
          threadId: ref.externalSessionId,
          cursor: null,
          limit: 100,
          sortDirection: "asc",
          itemsView: "full",
        },
      },
    ]);
  } finally {
    harness.adapter.releaseRuntime("runtime-live");
  }
});

test("inline output is selected only without a supplied path", async () => {
  for (const native of [completed(), { ...completed(), savedPath: "invalid-relative-path" }]) {
    const { adapter } = createImageHarness([native]);
    await adapter.prepareRuntime("runtime-live");
    try {
      const source = await adapter.resolveGeneratedImageSource({
        ref,
        itemId: "image",
        revision:
          native.savedPath !== undefined
            ? "file-digest"
            : codexImageGenerationPart(native).output!.revision,
      });
      expect(source.representation).toBe("savedPath" in native ? "saved_file" : "inline");
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
  }
});

test("wrong session, directory, item, turn, nonterminal outcome, and absent output are denied", async () => {
  for (const scenario of [
    { cwd: "/other" },
    { threadId: "other" },
    { itemId: "other" },
    { turnId: "other" },
    { items: [{ ...completed(), status: "failed" }] },
    { items: [{ ...completed(), result: "" }] },
  ]) {
    const { adapter } = createImageHarness(scenario.items, scenario.cwd, scenario.threadId);
    await adapter.prepareRuntime("runtime-live");
    try {
      await expect(
        adapter.resolveGeneratedImageSource({
          ref,
          itemId: scenario.itemId ?? "image",
          turnId: scenario.turnId ?? "turn",
          revision: codexImageGenerationPart(completed()).output!.revision,
        }),
      ).rejects.toThrow();
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
  }
});

test("concurrent reads share history and a released runtime cannot publish their output", async () => {
  const harness = createImageHarness();
  harness.defer();
  await harness.adapter.prepareRuntime("runtime-live");
  const input = {
    ref,
    itemId: "image",
    revision: codexImageGenerationPart(completed()).output!.revision,
  };
  const first = harness.adapter.resolveGeneratedImageSource(input);
  const second = harness.adapter.resolveGeneratedImageSource(input);
  const results = Promise.allSettled([first, second]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(harness.calls.filter((call) => call.method === "thread/turns/list")).toHaveLength(1);
  harness.adapter.releaseRuntime("runtime-live");
  harness.gate.resolve();
  for (const result of await results) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(String(result.reason)).toContain("runtime changed");
  }
});

{
  const source = "inline";
  test(`concurrent ${source} reads verify each expected revision against shared history`, async () => {
    const old = completed();
    const current = { ...old, result: "bmV3LWltYWdl" };
    const harness = createImageHarness([current]);
    harness.defer();
    await harness.adapter.prepareRuntime("runtime-live");
    try {
      const reads = Promise.allSettled(
        [old, current].map((native) =>
          harness.adapter.resolveGeneratedImageSource({
            ref,
            itemId: "image",
            turnId: "turn",
            revision:
              native.savedPath !== undefined
                ? "file-digest"
                : codexImageGenerationPart(native).output!.revision,
          }),
        ),
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(harness.calls.filter((call) => call.method === "thread/turns/list")).toHaveLength(1);
      harness.gate.resolve();
      expect(await reads).toEqual([
        {
          status: "rejected",
          reason: expect.objectContaining({ message: expect.stringContaining("output changed") }),
        },
        {
          status: "fulfilled",
          value: { representation: "inline", base64: current.result },
        },
      ]);
    } finally {
      harness.gate.resolve();
      harness.adapter.releaseRuntime("runtime-live");
    }
  });
}

test("runtime replacement during route resolution rejects the read before history access", async () => {
  const route = createDeferred<void>();
  const { adapter, transports } = createHarness({
    repoRuntimeResolver: {
      requireRepoRuntime: async () => {
        await route.promise;
        return { ...makeRuntimeSummary("runtime-live"), repoPath: ref.repoPath };
      },
    },
  });
  await adapter.prepareRuntime("runtime-live");
  const result = Promise.allSettled([
    adapter.resolveGeneratedImageSource({ ref, itemId: "image", revision: "old-output" }),
  ]);
  adapter.releaseRuntime("runtime-live");
  await adapter.prepareRuntime("runtime-live");
  route.resolve();
  expect(await result).toMatchObject([
    {
      status: "rejected",
      reason: expect.objectContaining({ message: expect.stringContaining("runtime changed") }),
    },
  ]);
  expect([...transports.values()].flatMap((transport) => transport.calls)).toEqual([]);
  adapter.releaseRuntime("runtime-live");
});

test("source verification awaits image preparation and rejects a replaced runtime", async () => {
  const native = completed();
  const started = createDeferred<void>();
  const result = createDeferred<ReturnType<typeof codexImageGenerationPart>[]>();
  const prepare = mock(async () => {
    started.resolve();
    return result.promise;
  });
  const { adapter } = createImageHarness([native], "/repo", ref.externalSessionId, prepare);
  await adapter.prepareRuntime("runtime-live");
  const pending = adapter.resolveGeneratedImageSource({
    ref,
    itemId: native.id,
    revision:
      native.savedPath !== undefined
        ? "file-digest"
        : codexImageGenerationPart(native).output!.revision,
  });
  await started.promise;
  adapter.releaseRuntime("runtime-live");
  await adapter.prepareRuntime("runtime-live");
  result.resolve([codexImageGenerationPart(native)]);
  try {
    await expect(pending).rejects.toThrow("runtime changed");
  } finally {
    adapter.releaseRuntime("runtime-live");
  }
});

test("oversized inline output is rejected before preparation but does not replace a saved source", async () => {
  const result = "AAAA".repeat(Math.ceil((32 * 1024 * 1024 + 1) / 3));
  const prepare = mock(async (images: Parameters<CodexImageGenerationPreparer>[0]) =>
    images.map(({ item }) => codexImageGenerationPart(item)),
  );
  for (const savedPath of [undefined, "/generated.png"]) {
    const native: CodexImageGenerationItem = { ...completed(), result };
    if (savedPath) native.savedPath = savedPath;
    const { adapter } = createImageHarness([native], "/repo", ref.externalSessionId, prepare);
    await adapter.prepareRuntime("runtime-live");
    try {
      const pending = adapter.resolveGeneratedImageSource({
        ref,
        itemId: native.id,
        revision: savedPath ? "file-digest" : "oversized",
      });
      if (savedPath) {
        expect(await pending).toEqual({
          representation: "saved_file",
          path: savedPath,
          revision: "file-digest",
        });
        expect(prepare).not.toHaveBeenCalled();
      } else {
        await expect(pending).rejects.toThrow("32 MiB");
        expect(prepare).not.toHaveBeenCalled();
      }
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
  }
});

for (const failure of ["wrong item", "missing", "worker failure"] as const) {
  test(`source verification rejects ${failure} without synchronous preparation`, async () => {
    const native = completed();
    const prepare: CodexImageGenerationPreparer = async () => {
      if (failure === "worker failure") throw new Error("worker failed");
      return failure === "missing"
        ? []
        : [{ ...codexImageGenerationPart(native), itemId: "other" }];
    };
    const { adapter } = createImageHarness([native], "/repo", ref.externalSessionId, prepare);
    await adapter.prepareRuntime("runtime-live");
    try {
      await expect(
        adapter.resolveGeneratedImageSource({
          ref,
          itemId: native.id,
          revision:
            native.savedPath !== undefined
              ? "file-digest"
              : codexImageGenerationPart(native).output!.revision,
        }),
      ).rejects.toThrow(failure === "worker failure" ? "worker failed" : "wrong item");
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
  });
}

for (const cancel of ["caller", "runtime"] as const) {
  test(`${cancel} cancellation reaches image preparation`, async () => {
    const started = createDeferred<AbortSignal>();
    const harness = createImageHarness(
      [completed()],
      "/repo",
      ref.externalSessionId,
      async (_images, signal) => {
        if (!signal) throw new Error("Missing preparation signal");
        started.resolve(signal);
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
        throw new Error("Unexpected preparation completion");
      },
    );
    await harness.adapter.prepareRuntime("runtime-live");
    const caller = new AbortController();
    const pending = harness.adapter.resolveGeneratedImageSource(
      { ref, itemId: "image", revision: codexImageGenerationPart(completed()).output!.revision },
      caller.signal,
    );
    const settled = pending.then(
      () => undefined,
      (cause: unknown) => cause,
    );
    try {
      const signal = await started.promise;
      if (cancel === "caller") caller.abort(new Error("preview canceled"));
      else harness.adapter.releaseRuntime("runtime-live");
      expect(signal.aborted).toBe(true);
      expect(await settled).toBe(signal.reason);
    } finally {
      caller.abort();
      harness.adapter.releaseRuntime("runtime-live");
      await settled;
    }
  });
}

test("canceling one shared history consumer prevents its preparation without canceling the other", async () => {
  const prepare = mock<CodexImageGenerationPreparer>(async (images) =>
    images.map(({ item, context }) => codexImageGenerationPart(item, context)),
  );
  const harness = createImageHarness([completed()], "/repo", ref.externalSessionId, prepare);
  await harness.adapter.prepareRuntime("runtime-live");
  harness.defer();
  const input = {
    ref,
    itemId: "image",
    revision: codexImageGenerationPart(completed()).output!.revision,
  };
  const caller = new AbortController();
  const canceled = harness.adapter.resolveGeneratedImageSource(input, caller.signal).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  const other = harness.adapter.resolveGeneratedImageSource(input);
  try {
    await harness.historyStarted.promise;
    caller.abort(new Error("preview canceled"));
    harness.gate.resolve();
    expect(await canceled).toBe(caller.signal.reason);
    expect(await other).toEqual({ representation: "inline", base64: completed().result });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(harness.calls.filter((call) => call.method === "thread/turns/list")).toHaveLength(1);
  } finally {
    harness.gate.resolve();
    harness.adapter.releaseRuntime("runtime-live");
  }
});

test("eight queued previews consume one bounded history batch and isolate an invalid item", async () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    ...completed(),
    id: `image-${index}`,
    status: index === 3 ? "failed" : "completed",
  }));
  const harness = createImageHarness(items);
  await harness.adapter.prepareRuntime("runtime-live");
  const images = items.map((item) => ({
    itemId: item.id,
    turnId: "turn",
    revision: codexImageGenerationPart(completed()).output!.revision,
  }));
  try {
    const batch = await harness.adapter.beginGeneratedImageBatch({ ref, images });
    for (const [index, image] of images.entries()) {
      const result = harness.adapter.resolveGeneratedImageSource({ ...batch, ...image });
      if (index === 3) await expect(result).rejects.toThrow("completed");
      else expect(await result).toEqual({ representation: "inline", base64: completed().result });
    }
    expect(harness.calls.filter(({ method }) => method === "thread/turns/list")).toHaveLength(1);
    harness.adapter.releaseGeneratedImageBatch(batch);
    await expect(
      harness.adapter.resolveGeneratedImageSource({ ...batch, ...images[0]! }),
    ).rejects.toThrow("expired");
  } finally {
    harness.adapter.releaseRuntime("runtime-live");
  }
});

test("image batches reject forged owners and revisions, release capacity, and die with their runtime", async () => {
  const harness = createImageHarness();
  await harness.adapter.prepareRuntime("runtime-live");
  const identity = {
    itemId: "image",
    turnId: "turn",
    revision: codexImageGenerationPart(completed()).output!.revision,
  };
  const input = { ref, images: [identity] };
  try {
    const first = await harness.adapter.beginGeneratedImageBatch(input);
    const second = await harness.adapter.beginGeneratedImageBatch(input);
    await expect(harness.adapter.beginGeneratedImageBatch(input)).rejects.toThrow(
      "two image preview batches",
    );
    await expect(
      harness.adapter.resolveGeneratedImageSource({
        ...first,
        ...identity,
        ref: { ...ref, externalSessionId: "other" },
      }),
    ).rejects.toThrow("another session");
    await expect(
      harness.adapter.resolveGeneratedImageSource({ ...first, ...identity, revision: "forged" }),
    ).rejects.toThrow("output revision");
    expect(await harness.adapter.resolveGeneratedImageSource({ ...first, ...identity })).toEqual({
      representation: "inline",
      base64: completed().result,
    });
    harness.adapter.releaseGeneratedImageBatch(first);
    const third = await harness.adapter.beginGeneratedImageBatch(input);
    harness.adapter.releaseRuntime("runtime-live");
    await harness.adapter.prepareRuntime("runtime-live");
    for (const batch of [second, third])
      await expect(
        harness.adapter.resolveGeneratedImageSource({ ...batch, ...identity }),
      ).rejects.toThrow("expired");
  } finally {
    harness.adapter.releaseRuntime("runtime-live");
  }
});

test("releasing an unloaded session clears its queued image batch", async () => {
  const harness = createImageHarness();
  await harness.adapter.prepareRuntime("runtime-live");
  const identity = {
    itemId: "image",
    turnId: "turn",
    revision: codexImageGenerationPart(completed()).output!.revision,
  };
  try {
    const batch = await harness.adapter.beginGeneratedImageBatch({ ref, images: [identity] });
    await harness.adapter.releaseSession(ref);
    await expect(
      harness.adapter.resolveGeneratedImageSource({ ...batch, ...identity }),
    ).rejects.toThrow("expired");
  } finally {
    harness.adapter.releaseRuntime("runtime-live");
  }
});

test("releasing a session during batch history discards the late result", async () => {
  const harness = createImageHarness();
  harness.defer();
  await harness.adapter.prepareRuntime("runtime-live");
  const pending = harness.adapter.beginGeneratedImageBatch({
    ref,
    images: [{ itemId: "image", revision: "digest" }],
  });
  const result = Promise.allSettled([pending]);
  try {
    await harness.historyStarted.promise;
    await harness.adapter.releaseSession(ref);
    harness.gate.resolve();
    expect((await result)[0]).toMatchObject({ status: "rejected" });
  } finally {
    harness.gate.resolve();
    harness.adapter.releaseRuntime("runtime-live");
  }
});

test("two near-limit batches retain bounded sources and release reservations after active work stops", async () => {
  const large = "AAAA".repeat(Math.floor((32 * 1024 * 1024) / 3));
  const items = Array.from({ length: 8 }, (_, index) => ({
    ...completed(),
    id: `large-${index}`,
    result: large,
  }));
  const started = createDeferred<void>();
  const finish = createDeferred<void>();
  const prepare: CodexImageGenerationPreparer = async (images) => {
    started.resolve();
    await finish.promise;
    return images.map(({ item, context }) => ({
      ...codexImageGenerationPart({ ...item, result: "" }, context),
      output: { revision: "digest" },
    }));
  };
  const { adapter } = createImageHarness(items, "/repo", ref.externalSessionId, prepare);
  await adapter.prepareRuntime("runtime-live");
  const images = items.map(({ id }) => ({ itemId: id, turnId: "turn", revision: "digest" }));
  let pending: Promise<unknown> | undefined;
  try {
    const first = await adapter.beginGeneratedImageBatch({ ref, images });
    const second = await adapter.beginGeneratedImageBatch({ ref, images });
    expect(first.admittedImages).toEqual(images.slice(0, 1));
    expect(second.admittedImages).toEqual(images.slice(0, 1));
    const retainedBytes =
      (first.admittedImages.length + second.admittedImages.length) * large.length * 2;
    expect(retainedBytes).toBeLessThanOrEqual(192 * 1024 * 1024);
    pending = adapter
      .resolveGeneratedImageSource({ ...first, ...images[0]! })
      .catch((error) => error);
    await started.promise;
    adapter.releaseGeneratedImageBatch(first);
    await expect(adapter.beginGeneratedImageBatch({ ref, images })).rejects.toThrow(
      "two image preview batches",
    );
    finish.resolve();
    expect(await pending).toBeInstanceOf(Error);
    const next = await adapter.beginGeneratedImageBatch({ ref, images: images.slice(1) });
    expect(next.admittedImages).toEqual(images.slice(1, 2));
    adapter.releaseGeneratedImageBatch(next);
    adapter.releaseGeneratedImageBatch(second);
  } finally {
    finish.resolve();
    await pending;
    adapter.releaseRuntime("runtime-live");
  }
});
