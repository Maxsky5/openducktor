import { describe, expect, test } from "bun:test";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { MessagePartItem } from "./transcript-message-parts";
import { type MessagePartsOf, topRowIndex, transcriptListItems } from "./transcript-list-items";

const rows = ["a", "b", "c"].map((key): AgentChatTranscriptRow => ({
  kind: "turn_duration",
  key,
  durationMs: 1,
}));
const whole: MessagePartsOf = () => null;

const part = (key: string, start: number): MessagePartItem => ({
  kind: "message_part",
  look: "answer",
  key: `${key}:${start}`,
  rowKey: key,
  messageId: key,
  chunk: { start, text: "" },
  previous: null,
  message: null,
});
// Row `b` is a long message in three parts.
const splitB: MessagePartsOf = (row) =>
  row.key === "b" ? [part("b", 0), part("b", 10), part("b", 20)] : null;

describe("transcript list items", () => {
  test("puts the rows between the top and the bottom edges", () => {
    expect(transcriptListItems(rows, whole).items.map((item) => item.key)).toEqual([
      "transcript:top-edge",
      "a",
      "b",
      "c",
      "transcript:bottom-edge",
    ]);
  });

  test("shows a long message as its parts", () => {
    expect(transcriptListItems(rows, splitB).items.map((item) => item.key)).toEqual([
      "transcript:top-edge",
      "a",
      "b:0",
      "b:10",
      "b:20",
      "c",
      "transcript:bottom-edge",
    ]);
  });

  test("finds the item at the top of each row", () => {
    const topKeys = (partsOf: MessagePartsOf) => {
      const list = transcriptListItems(rows, partsOf);
      return list.topItemOfRow.map((index) => list.items[index]?.key);
    };
    expect(topKeys(whole)).toEqual(["a", "b", "c"]);
    expect(topKeys(splitB)).toEqual(["a", "b:0", "c"]);
  });

  test("finds the row at the top of the screen", () => {
    const list = transcriptListItems(rows, whole);
    expect(topRowIndex(list, [2, 3])).toBe(1);
    expect(topRowIndex(list, [0, 1])).toBe(0);
    expect(topRowIndex(list, [])).toBeNull();
    // A part of a long message stands for its message row.
    expect(topRowIndex(transcriptListItems(rows, splitB), [3, 4])).toBe(1);
  });

  test("finds no row in an empty transcript", () => {
    expect(topRowIndex(transcriptListItems([], whole), [0, 1])).toBeNull();
  });
});
