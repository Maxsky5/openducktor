import { expect, test } from "bun:test";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { mergeReadonlyRuntimeHistory } from "@/components/features/agents/agent-chat/readonly-transcript/readonly-transcript-session";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  createImageGenerationMessage,
  upsertImageGenerationMessage,
} from "./image-generation-messages";
import { createSessionMessagesState } from "./messages";
import {
  recordImageGenerationSessionEnd,
  recordImageGenerationTurnEnd,
} from "./image-generation-settlement";

const timestamp = "2026-09-06T10:00:00.000Z";
const part: AgentImageGenerationPart = {
  kind: "image_generation",
  itemId: "image",
  messageId: "image",
  partId: "image",
  turnId: "turn",
  status: "running",
};

for (const reason of ["turn_ended", "runtime_failure"] as const) {
  test(`session-wide ${reason} settles late readonly history and preserves native outcomes`, () => {
    const initial = createAgentSessionFixture();
    const ended = recordImageGenerationSessionEnd(initial, timestamp, reason);
    const settled = mergeReadonlyRuntimeHistory(ended, [
      { messageId: "image", role: "assistant", text: "", timestamp, parts: [part] },
    ]);
    expect(settled.messages.items[0]?.meta).toMatchObject({
      status: "incomplete",
      incompleteReason: reason,
    });
    expect(settled.status).toBe(initial.status);
    const completed = mergeReadonlyRuntimeHistory(settled, [
      {
        messageId: "image",
        role: "assistant",
        text: "",
        timestamp,
        parts: [{ ...part, status: "completed" }],
      },
    ]);
    expect(completed.messages.items[0]?.meta).toMatchObject({ status: "completed" });
    const failed = mergeReadonlyRuntimeHistory(ended, [
      {
        messageId: "image",
        role: "assistant",
        text: "",
        timestamp,
        parts: [{ ...part, status: "failed" }],
      },
    ]);
    expect(failed.messages.items[0]?.meta).toMatchObject({ status: "failed" });
  });
}

test("session end leaves later image output running", () => {
  const initial = createAgentSessionFixture();
  const later = "2026-09-06T10:00:01.000Z";
  initial.messages = createSessionMessagesState(initial.externalSessionId, [
    createImageGenerationMessage(part, later),
  ]);
  const ended = recordImageGenerationSessionEnd(initial, timestamp, "runtime_failure");
  expect(ended.messages.items[0]?.meta).toMatchObject({ status: "running" });
});

test("arbitrary turn IDs cannot inherit a terminal marker from Object.prototype", () => {
  const initial = recordImageGenerationTurnEnd(createAgentSessionFixture(), "other", "interrupted");
  const messages = upsertImageGenerationMessage(
    initial,
    { ...part, turnId: "constructor" },
    timestamp,
  );
  expect(messages.items[0]?.meta).toMatchObject({ status: "running" });
  const settled = recordImageGenerationTurnEnd(
    { ...initial, messages },
    "constructor",
    "interrupted",
  );
  expect(settled.messages.items[0]?.meta).toMatchObject({ status: "interrupted" });
});
