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

for (const [turnStatus, expected] of [
  ["interrupted", { status: "interrupted" }],
  ["failed", { status: "incomplete", incompleteReason: "runtime_failure" }],
  ["completed", { status: "incomplete", incompleteReason: "incomplete_history" }],
  ["inProgress", { status: "incomplete", incompleteReason: "unknown_status" }],
] as const) {
  test(`request-only history preserves the ${turnStatus} turn outcome for an unknown image status`, async () => {
    const ref = { ...codexSessionRuntimeRef(), externalSessionId: "unknown-image-status" };
    const adapter = createAdapterWithTransport(
      {
        request: async (request) => {
          if (request.method === "thread/read") {
            return {
              thread: codexThreadFixture({
                id: ref.externalSessionId,
                cwd: ref.workingDirectory,
                status: { type: "active", activeFlags: [] },
              }),
            };
          }
          if (request.method === "thread/turns/list") {
            return {
              data: [
                codexTurnFixture({
                  id: "turn",
                  status: turnStatus,
                  items: [
                    {
                      type: "imageGeneration",
                      id: "image",
                      status: "future_status",
                      result: "",
                      revisedPrompt: null,
                      transparentBackground: null,
                      failure: null,
                    },
                  ],
                }),
              ],
              nextCursor: null,
              backwardsCursor: null,
            };
          }
          throw new Error(`Unexpected request: ${request.method}`);
        },
      },
      { subscribeEvents: undefined },
    );
    try {
      const history = await adapter.loadSessionHistory(ref);
      const images = history
        .flatMap((message) => message.parts)
        .filter((part) => part.kind === "image_generation");
      expect(images).toHaveLength(1);
      expect(images[0]).toMatchObject(expected);
    } finally {
      adapter.releaseRuntime("runtime-live");
    }
  });
}

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
