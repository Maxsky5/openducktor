import { expect, test } from "bun:test";
import type { CodexAppServerThreadItem } from "@openducktor/contracts";
import { codexImageGenerationPart, type CodexImageGenerationItem } from "./codex-image-generation";
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
) => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const gate = createDeferred<void>();
  let deferred = false;
  const { adapter } = createHarness({
    transportFactory: (runtimeId) => {
      const transport = new RecordingTransport(runtimeId, false);
      return {
        request: async (request) => {
          calls.push({ method: request.method, params: request.params });
          if (request.method === "thread/read")
            return { thread: codexThreadFixture({ id: threadId, cwd, status: { type: "idle" } }) };
          if (request.method === "thread/turns/list") {
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
  });
  return {
    adapter,
    calls,
    gate,
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
        revision: codexImageGenerationPart(native).output!.revision,
      }),
    ).toEqual({ representation: "saved_file", path: "/generated/image.png" });
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
        revision: codexImageGenerationPart(native).output!.revision,
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
      ).rejects.toThrow("unavailable");
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

for (const source of ["saved", "inline"] as const) {
  test(`concurrent ${source} reads verify each expected revision against shared history`, async () => {
    const old = source === "saved" ? { ...completed(), savedPath: "/old.png" } : completed();
    const current =
      source === "saved" ? { ...old, savedPath: "/new.png" } : { ...old, result: "bmV3LWltYWdl" };
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
            revision: codexImageGenerationPart(native).output!.revision,
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
          value:
            source === "saved"
              ? { representation: "saved_file", path: "/new.png" }
              : { representation: "inline", base64: current.result },
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
