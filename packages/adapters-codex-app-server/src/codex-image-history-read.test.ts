import { expect, spyOn, test } from "bun:test";
import type { CodexAppServerThreadItem } from "@openducktor/contracts";
import { CodexImageGenerationState } from "./codex-image-generation-state";
import {
  codexSessionRuntimeRef,
  codexThreadFixture,
  codexTurnFixture,
  createAdapterWithTransport,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";

test("request-only history reads do not allocate image lifecycle owners or reuse old image parts", async () => {
  const transport = new RecordingTransport("runtime-live", false);
  const ref = { ...codexSessionRuntimeRef(), externalSessionId: "request-only-images" };
  let items: CodexAppServerThreadItem[] = [];
  let failRead = false;
  const adapter = createAdapterWithTransport(
    {
      request: async (request) => {
        if (request.method === "thread/read")
          return {
            thread: codexThreadFixture({
              id: ref.externalSessionId,
              cwd: ref.workingDirectory,
              status: { type: "active", activeFlags: [] },
            }),
          };
        if (request.method === "thread/turns/list") {
          if (failRead) throw new Error("History unavailable");
          return {
            data: [codexTurnFixture({ id: "turn", status: "inProgress", items })],
            nextCursor: null,
            backwardsCursor: null,
          };
        }
        return transport.request(request);
      },
    },
    { subscribeEvents: undefined },
  );
  const prepare = spyOn(CodexImageGenerationState.prototype, "prepareHistory");
  try {
    await adapter.loadSessionHistory(ref);
    items = [
      {
        type: "imageGeneration",
        id: "image",
        status: "completed",
        result: "YQ==",
        revisedPrompt: "A duck",
        transparentBackground: null,
        failure: null,
      },
    ];
    const completed = await adapter.loadSessionHistory(ref);
    expect(completed.flatMap((message) => message.parts)).toContainEqual(
      expect.objectContaining({ kind: "image_generation", status: "completed" }),
    );
    items = [
      {
        ...items[0]!,
        type: "imageGeneration",
        id: "image",
        status: "in_progress",
        result: "",
        revisedPrompt: null,
        transparentBackground: null,
        failure: null,
      },
    ];
    const current = await adapter.loadSessionHistory(ref);
    expect(current.flatMap((message) => message.parts)).toContainEqual(
      expect.objectContaining({ kind: "image_generation", status: "running" }),
    );
    failRead = true;
    await expect(adapter.loadSessionHistory(ref)).rejects.toThrow("History unavailable");
    expect(
      prepare.mock.calls.filter(([, threadId]) => threadId === ref.externalSessionId),
    ).toHaveLength(0);
  } finally {
    prepare.mockRestore();
    adapter.releaseRuntime("runtime-live");
  }
});
