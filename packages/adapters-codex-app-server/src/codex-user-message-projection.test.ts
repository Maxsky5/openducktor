import { describe, expect, test } from "bun:test";
import {
  codexSessionRef,
  codexThreadFixture,
  codexTurnFixture,
  createAdapterWithTransport,
} from "./codex-app-server-adapter.test-harness";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import { projectCodexCanonicalEventsToHistory } from "./codex-history-projector";
import type { CodexJsonRpcRequest, CodexJsonRpcTransport } from "./index";
import { codexUserMessageItemFixture } from "./test-fixtures/codex-protocol";

const IMAGE_PATH =
  "/tmp/openducktor-local-attachments/550e8400-e29b-41d4-a716-446655440000-Screenshot.png";

describe("Codex user message projection", () => {
  test("loads image messages without adding local paths to visible text", async () => {
    const thread = codexThreadFixture({
      id: "thread-images",
      cwd: "/repo",
      status: { type: "idle" },
      turns: [
        codexTurnFixture({
          id: "turn-1",
          status: "completed",
          items: [
            codexUserMessageItemFixture({
              id: "user-text-image",
              content: [
                { type: "text", text: "Inspect this screenshot", text_elements: [] },
                { type: "localImage", path: IMAGE_PATH },
              ],
            }),
            codexUserMessageItemFixture({
              id: "user-image-only",
              content: [{ type: "localImage", path: IMAGE_PATH }],
            }),
          ],
        }),
      ],
    });
    const transport: CodexJsonRpcTransport = {
      async request(request: CodexJsonRpcRequest) {
        if (request.method === "thread/read") {
          return { thread: { ...thread, turns: [] } };
        }
        if (request.method === "thread/turns/list") {
          return {
            data: thread.turns,
            nextCursor: null,
            backwardsCursor: null,
          };
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };

    const history = await createAdapterWithTransport(transport).loadSessionHistory(
      codexSessionRef("thread-images"),
    );

    expect(history).toEqual([
      expect.objectContaining({
        messageId: "user-text-image",
        text: "Inspect this screenshot",
        displayParts: [
          { kind: "text", text: "Inspect this screenshot" },
          expect.objectContaining({
            kind: "attachment",
            attachment: expect.objectContaining({ path: IMAGE_PATH }),
          }),
        ],
      }),
      expect.objectContaining({
        messageId: "user-image-only",
        text: "",
        displayParts: [
          expect.objectContaining({
            kind: "attachment",
            attachment: expect.objectContaining({ path: IMAGE_PATH }),
          }),
        ],
      }),
    ]);
  });

  test("maps an image-only item to canonical history", () => {
    const events = createCodexEventMapperPipeline().runThreadItem(
      {
        item: codexUserMessageItemFixture({
          id: "user-image-only",
          content: [{ type: "localImage", path: IMAGE_PATH }],
        }),
        index: 0,
      },
      { source: "thread_read", threadId: "thread-images" },
    );

    expect(projectCodexCanonicalEventsToHistory(events)).toEqual([
      expect.objectContaining({
        messageId: "user-image-only",
        text: "",
        displayParts: [
          expect.objectContaining({
            kind: "attachment",
            attachment: expect.objectContaining({ path: IMAGE_PATH }),
          }),
        ],
      }),
    ]);
  });
});
