import { expect, test } from "bun:test";
import type { CodexAppServerJsonValue } from "@openducktor/contracts";
import { createCodexImageSessionHarness } from "./codex-image-session.test-harness";
import { imageSessionRef } from "./codex-image-runtime.test-fixtures";

const requestCases: {
  message: { id: number; method: string; params: CodexAppServerJsonValue };
  error: string;
  malformed: boolean;
}[] = [
  {
    message: {
      id: 71,
      method: "item/tool/requestUserInput",
      params: {
        turnId: "turn",
        itemId: "tool",
        questions: [],
        autoResolutionMs: null,
        isBlocking: true,
      },
    },
    error: "threadId",
    malformed: true,
  },
  {
    message: { id: 72, method: "attestation/generate", params: {} },
    error: "missing a thread identifier",
    malformed: false,
  },
  {
    message: {
      id: 73,
      method: "item/tool/call",
      params: {
        arguments: {},
        callId: "call",
        namespace: null,
        threadId: "thread-affected",
        tool: "test_tool",
        turnId: "turn",
      },
    },
    error: "Rejected Codex dynamic tool request",
    malformed: false,
  },
];
for (const { message, error, malformed } of requestCases) {
  test(`${message.method} failure settles only its runtime and preserves native outcomes`, async () => {
    const harness = await createCodexImageSessionHarness(["other", "affected"]);
    try {
      for (const runtime of ["other", "affected"]) {
        await harness.startTurn(runtime, "turn");
        await harness.image(runtime, "turn", "running");
        await harness.image(runtime, "turn", "done", "completed");
      }
      expect(harness.images("affected").map((image) => image.meta)).toMatchObject([
        { status: "running" },
        { status: "completed" },
      ]);
      await harness.notify("affected", {
        method: "item/agentMessage/delta",
        params: {
          threadId: imageSessionRef("affected").externalSessionId,
          turnId: "turn",
          itemId: "text",
          delta: "Keep this explanation.",
        },
      });
      const otherBefore = harness.session("other");
      const eventCount = harness.events.length;
      await (malformed ? harness.malformedRequest : harness.request)("affected", message);
      expect(harness.session("affected").status).toBe("error");
      expect(harness.images("affected").map((image) => image.meta)).toMatchObject([
        { status: "incomplete", incompleteReason: "runtime_failure", revisedPrompt: "A duck" },
        { status: "completed", revisedPrompt: "A duck" },
      ]);
      expect(
        harness.messages("affected").some((entry) => entry.content === "Keep this explanation."),
      ).toBe(true);
      expect(harness.session("other")).toBe(otherBefore);
      const failures = harness.events.slice(eventCount);
      expect(failures.every((event) => event.externalSessionId === "thread-affected")).toBe(true);
      expect(failures[0]).toMatchObject({
        type: "image_generation_settled",
        reason: "runtime_failure",
      });
      expect(failures.at(-1)).toMatchObject({
        type: "session_error",
        message: expect.stringContaining(error),
      });
      await harness.image("affected", "turn", "running", "completed");
      expect(harness.images("affected")[0]?.meta).toMatchObject({ status: "completed" });
      await harness.startTurn("affected", "next");
      await harness.image("affected", "next", "new");
      expect(harness.images("affected").at(-1)?.meta).toMatchObject({
        status: "running",
        turnId: "next",
        itemId: "new",
      });
    } finally {
      harness.close();
    }
  });
}

for (const status of ["failed", "interrupted", "completed"] as const) {
  test(`replayed ${status} turn preserves a newer running image`, async () => {
    const harness = await createCodexImageSessionHarness();
    const runtime = "runtime-live";
    try {
      await harness.startTurn(runtime, "old");
      await harness.image(runtime, "old", "old-image");
      await harness.endTurn(runtime, "old", status);
      expect(harness.images(runtime)[0]?.meta).toMatchObject({
        status: status === "interrupted" ? "interrupted" : "incomplete",
      });
      await harness.startTurn(runtime, "new");
      await harness.image(runtime, "new", "new-image");
      const newImage = harness.images(runtime)[1];
      expect(newImage?.meta).toMatchObject({ status: "running", turnId: "new" });
      const beforeReplay = harness.events.length;
      await harness.endTurn(runtime, "old", status);
      const replay = harness.events.slice(beforeReplay);
      expect(replay.filter((event) => event.type === "image_generation_settled")).toEqual([
        expect.objectContaining({
          turnId: "old",
          reason:
            status === "failed"
              ? "runtime_failure"
              : status === "interrupted"
                ? "interrupted"
                : "turn_ended",
        }),
      ]);
      expect(
        replay.some(
          (event) =>
            event.type === "assistant_part" &&
            event.part.kind === "image_generation" &&
            event.part.itemId === "new-image",
        ),
      ).toBe(false);
      expect(harness.images(runtime)[1]).toBe(newImage);
      await harness.image(runtime, "new", "new-image", "completed");
      expect(harness.images(runtime)[1]?.meta).toMatchObject({ status: "completed" });
    } finally {
      harness.close();
    }
  });
}
