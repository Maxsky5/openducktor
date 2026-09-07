import { expect, mock, spyOn, test } from "bun:test";
import type {
  CodexImageGenerationItem,
  CodexImageGenerationPreparer,
} from "./codex-image-generation";
import * as imageGeneration from "./codex-image-generation";
import {
  codexSessionRuntimeRef,
  codexThreadFixture,
  codexTurnFixture,
  createAdapterWithTransport,
  createDeferred,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";

const ref = { ...codexSessionRuntimeRef(), externalSessionId: "images" };
const items: CodexImageGenerationItem[] = ["one", "two"].map((id) => ({
  type: "imageGeneration",
  id,
  status: "completed",
  result: id,
  revisedPrompt: null,
  transparentBackground: null,
  failure: null,
}));
const parts = items.map((item) =>
  imageGeneration.codexImageGenerationPart(item, { turnId: "turn", turnStatus: "completed" }),
);

const createAdapter = (prepareImageGenerations: CodexImageGenerationPreparer) => {
  const transport = new RecordingTransport("runtime-live", false);
  return createAdapterWithTransport(
    {
      request: async (request) => {
        if (request.method === "thread/read")
          return {
            thread: codexThreadFixture({
              id: ref.externalSessionId,
              cwd: ref.workingDirectory,
              status: { type: "idle" },
            }),
          };
        if (request.method === "thread/turns/list")
          return {
            data: [codexTurnFixture({ id: "turn", status: "completed", items })],
            nextCursor: null,
            backwardsCursor: null,
          };
        return transport.request(request);
      },
    },
    { subscribeEvents: undefined, prepareImageGenerations },
  );
};

test("renderer history waits for prepared images and maps them without hashing again", async () => {
  const gate = createDeferred<typeof parts>();
  const entered = createDeferred<void>();
  const prepare = mock<CodexImageGenerationPreparer>(async () => {
    entered.resolve();
    return gate.promise;
  });
  const adapter = createAdapter(prepare);
  const hash = spyOn(imageGeneration, "codexImageGenerationPart");
  try {
    const pending = adapter.loadSessionHistory(ref);
    await entered.promise;
    expect(prepare.mock.calls[0]?.[0]).toEqual(
      items.map((item) => ({ item, context: { turnId: "turn", turnStatus: "completed" } })),
    );
    gate.resolve(parts);
    const history = await pending;
    expect(history.flatMap((message) => message.parts)).toEqual(parts);
    expect(hash).not.toHaveBeenCalled();
  } finally {
    hash.mockRestore();
    adapter.releaseRuntime("runtime-live");
  }
});

for (const result of [[], [parts[0]!], [parts[1]!, parts[0]!]]) {
  test("missing or mismatched preparation fails without falling back to synchronous hashing", async () => {
    const adapter = createAdapter(async () => result);
    const hash = spyOn(imageGeneration, "codexImageGenerationPart");
    try {
      await expect(adapter.loadSessionHistory(ref)).rejects.toThrow("Image history preparation");
      expect(hash).not.toHaveBeenCalled();
    } finally {
      hash.mockRestore();
      adapter.releaseRuntime("runtime-live");
    }
  });
}

test("preparation failure reaches the history caller", async () => {
  const adapter = createAdapter(async () => {
    throw new Error("worker failed");
  });
  try {
    await expect(adapter.loadSessionHistory(ref)).rejects.toThrow("worker failed");
  } finally {
    adapter.releaseRuntime("runtime-live");
  }
});
