import { describe, expect, test } from "bun:test";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { MessagePartItem } from "./transcript-message-parts";
import {
  type MessagePartsOf,
  topRowIndex,
  type TranscriptListKind,
  transcriptListItems,
} from "./transcript-list-items";

const rows = ["a", "b", "c"].map((key): AgentChatTranscriptRow => ({
  kind: "turn_duration",
  key,
  durationMs: 1,
}));
const latest = "latest";
const first = "first";
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
  test("the latest list starts under the latest row, and the first list above the first row", () => {
    expect(transcriptListItems(latest, rows, whole).items.map((item) => item.key)).toEqual([
      "transcript:bottom-edge",
      "c",
      "b",
      "a",
      "transcript:top-edge",
    ]);
    expect(transcriptListItems(first, rows, whole).items.map((item) => item.key)).toEqual([
      "transcript:top-edge",
      "a",
      "b",
      "c",
      "transcript:bottom-edge",
    ]);
  });

  test("shows a long message as its parts, from the bottom in the latest list", () => {
    expect(transcriptListItems(latest, rows, splitB).items.map((item) => item.key)).toEqual([
      "transcript:bottom-edge",
      "c",
      "b:20",
      "b:10",
      "b:0",
      "a",
      "transcript:top-edge",
    ]);
    expect(transcriptListItems(first, rows, splitB).items.map((item) => item.key)).toEqual([
      "transcript:top-edge",
      "a",
      "b:0",
      "b:10",
      "b:20",
      "c",
      "transcript:bottom-edge",
    ]);
  });

  test("finds the item at the top of each row in each list", () => {
    const topKeys = (kind: TranscriptListKind, partsOf: MessagePartsOf) => {
      const list = transcriptListItems(kind, rows, partsOf);
      return list.topItemOfRow.map((index) => list.items[index]?.key);
    };
    for (const kind of [latest, first] as const) {
      expect(topKeys(kind, whole)).toEqual(["a", "b", "c"]);
      expect(topKeys(kind, splitB)).toEqual(["a", "b:0", "c"]);
    }
  });

  test("finds the row at the top of the screen in each list", () => {
    // The latest list shows its highest index at the top.
    const latestList = transcriptListItems(latest, rows, whole);
    expect(topRowIndex(latest, latestList, [0, 1, 2])).toBe(1);
    expect(topRowIndex(latest, latestList, [3, 4])).toBe(0);
    const firstList = transcriptListItems(first, rows, whole);
    expect(topRowIndex(first, firstList, [2, 3])).toBe(1);
    expect(topRowIndex(first, firstList, [0, 1])).toBe(0);
    expect(topRowIndex(first, firstList, [])).toBeNull();
    // A part of a long message stands for its message row.
    expect(topRowIndex(latest, transcriptListItems(latest, rows, splitB), [1, 2, 3])).toBe(1);
    expect(topRowIndex(first, transcriptListItems(first, rows, splitB), [3, 4])).toBe(1);
  });

  test("finds no row in an empty transcript", () => {
    expect(topRowIndex(first, transcriptListItems(first, [], whole), [0, 1])).toBeNull();
  });
});
