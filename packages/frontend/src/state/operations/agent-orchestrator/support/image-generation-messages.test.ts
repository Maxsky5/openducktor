import { expect, test } from "bun:test";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import {
  createImageGenerationMessage,
  upsertImageGenerationMessage,
} from "./image-generation-messages";
import { mergeHistoryMessages } from "./history-message-merge";
import { createSessionMessagesState } from "./messages";
import { historyToChatMessages } from "./session-history-chat-messages";

const timestamp = "2026-09-06T10:00:00.000Z";
const image = (
  status: AgentImageGenerationPart["status"],
  itemId = "image",
): AgentImageGenerationPart => ({
  kind: "image_generation",
  messageId: itemId,
  partId: itemId,
  itemId,
  turnId: "turn",
  status,
  revisedPrompt: "A duck",
});
const completed = {
  ...image("completed"),
  output: { revision: "output-v1" },
};

test("start, completion, and replay keep one row in its first position before following text", () => {
  const owner = { externalSessionId: "thread", messages: createSessionMessagesState("thread") };
  owner.messages = upsertImageGenerationMessage(owner, image("running"), timestamp);
  const text = { id: "text", role: "assistant" as const, content: "Here is your image", timestamp };
  owner.messages = createSessionMessagesState("thread", [...owner.messages.items, text]);
  owner.messages = upsertImageGenerationMessage(owner, completed, "2026-09-06T10:01:00.000Z");
  owner.messages = upsertImageGenerationMessage(owner, image("running"), timestamp);
  expect(owner.messages.items).toEqual([createImageGenerationMessage(completed, timestamp), text]);
  owner.messages = upsertImageGenerationMessage(owner, image("completed", "other"), timestamp);
  expect(owner.messages.items).toHaveLength(3);
});

test("history and live overlap preserve terminal output and fill absent metadata", () => {
  const history = historyToChatMessages(
    [
      {
        messageId: "image",
        role: "assistant",
        timestamp,
        text: "",
        parts: [{ ...completed, savedPath: "/runtime/duck.png" }],
      },
    ],
    { role: null },
  );
  expect(history).toEqual([
    createImageGenerationMessage({ ...completed, savedPath: "/runtime/duck.png" }, timestamp),
  ]);
  const live = createSessionMessagesState("thread", [
    createImageGenerationMessage(image("running"), timestamp),
  ]);
  const merged = mergeHistoryMessages(
    "thread",
    createSessionMessagesState("thread", history),
    live,
  );
  expect(merged.items).toHaveLength(1);
  expect(merged.items[0]?.meta).toMatchObject({ status: "completed", output: completed.output });
  const old = createSessionMessagesState("thread", [
    createImageGenerationMessage(image("incomplete"), timestamp),
  ]);
  expect(mergeHistoryMessages("thread", old, merged).items).toEqual(merged.items);
  const owner = { externalSessionId: "thread", messages: merged };
  expect(upsertImageGenerationMessage(owner, image("running"), timestamp).items).toEqual(
    merged.items,
  );
});

test("a live image observation replaces a synthesized history timestamp before terminal checks", () => {
  const owner = {
    externalSessionId: "thread",
    messages: createSessionMessagesState("thread", [
      {
        ...createImageGenerationMessage(image("running"), "2026-09-06T10:00:10.000Z"),
        timestampIsApproximate: true,
      },
    ]),
  };
  const updated = upsertImageGenerationMessage(owner, image("running"), timestamp);
  expect(updated.items[0]?.timestamp).toBe(timestamp);
  expect(updated.items[0]?.timestampIsApproximate).toBeUndefined();
});
