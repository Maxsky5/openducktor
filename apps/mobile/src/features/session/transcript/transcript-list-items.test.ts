import { describe, expect, test } from "bun:test";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import { readToolRunClassifier } from "@openducktor/frontend-core/sessions/transcript/tool-runs";
import { buildMessage } from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import type { MessagePartItem } from "./transcript-message-parts";
import {
  type MessagePartsOf,
  topRowIndex,
  type TranscriptListItems,
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
const classify = readToolRunClassifier(
  resolveAgentChatRuntimePresentation({ runtimeDefinitions: [], runtimeKind: null })
    .presentToolCall,
);

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
    expect(
      transcriptListItems(latest, rows, whole, classify).items.map((item) => item.key),
    ).toEqual(["transcript:bottom-edge", "c", "b", "a", "transcript:top-edge"]);
    expect(transcriptListItems(first, rows, whole, classify).items.map((item) => item.key)).toEqual(
      ["transcript:top-edge", "a", "b", "c", "transcript:bottom-edge"],
    );
  });

  test("shows a long message as its parts, from the bottom in the latest list", () => {
    expect(
      transcriptListItems(latest, rows, splitB, classify).items.map((item) => item.key),
    ).toEqual(["transcript:bottom-edge", "c", "b:20", "b:10", "b:0", "a", "transcript:top-edge"]);
    expect(
      transcriptListItems(first, rows, splitB, classify).items.map((item) => item.key),
    ).toEqual(["transcript:top-edge", "a", "b:0", "b:10", "b:20", "c", "transcript:bottom-edge"]);
  });

  test("finds the item at the top of each row in each list", () => {
    const topKeys = (kind: TranscriptListKind, partsOf: MessagePartsOf) => {
      const list = transcriptListItems(kind, rows, partsOf, classify);
      return list.topItemOfRow.map((index) => list.items[index]?.key);
    };
    for (const kind of [latest, first] as const) {
      expect(topKeys(kind, whole)).toEqual(["a", "b", "c"]);
      expect(topKeys(kind, splitB)).toEqual(["a", "b:0", "c"]);
    }
  });

  test("finds the row at the top of the screen in each list", () => {
    // The latest list shows its highest index at the top.
    const latestList = transcriptListItems(latest, rows, whole, classify);
    expect(topRowIndex(latestList, [0, 1, 2])).toBe(1);
    expect(topRowIndex(latestList, [3, 4])).toBe(0);
    const firstList = transcriptListItems(first, rows, whole, classify);
    expect(topRowIndex(firstList, [2, 3])).toBe(1);
    expect(topRowIndex(firstList, [0, 1])).toBe(0);
    expect(topRowIndex(firstList, [])).toBeNull();
    // A part of a long message stands for its message row.
    expect(topRowIndex(transcriptListItems(latest, rows, splitB, classify), [1, 2, 3])).toBe(1);
    expect(topRowIndex(transcriptListItems(first, rows, splitB, classify), [3, 4])).toBe(1);
  });

  test("finds no row in an empty transcript", () => {
    expect(topRowIndex(transcriptListItems(first, [], whole, classify), [0, 1])).toBeNull();
  });
});

const toolRow = (key: string, tool: string): AgentChatTranscriptRow => ({
  kind: "message",
  key,
  message: buildMessage("tool", `Tool ${key}`, {
    id: key,
    meta: {
      kind: "tool",
      partId: `${key}-part`,
      callId: `${key}-call`,
      tool,
      toolType: "generic",
      status: "completed",
      input: { query: key },
    },
  }),
});

const shellRow = (
  key: string,
  status: "completed" | "error" | "running" = "completed",
): AgentChatTranscriptRow => ({
  kind: "message",
  key,
  message: buildMessage("tool", `Tool ${key}`, {
    id: key,
    meta: {
      kind: "tool",
      partId: `${key}-part`,
      callId: `${key}-call`,
      tool: "bash",
      toolType: "bash",
      status,
      input: { command: `echo ${key}` },
    },
  }),
});

describe("tool runs", () => {
  const runRows = [
    rows[0]!,
    shellRow("s1"),
    shellRow("s2", "error"),
    shellRow("s3"),
    rows[1]!,
    shellRow("solo"),
  ];
  const keys = (kind: TranscriptListKind) =>
    transcriptListItems(kind, runRows, whole, classify).items.map((item) => item.key);

  test("shows each run as one item, in the order of each list", () => {
    expect(keys(first)).toEqual([
      "transcript:top-edge",
      "a",
      "s1:tool-run",
      "b",
      "solo:tool-run",
      "transcript:bottom-edge",
    ]);
    expect(keys(latest)).toEqual([
      "transcript:bottom-edge",
      "solo:tool-run",
      "b",
      "s1:tool-run",
      "a",
      "transcript:top-edge",
    ]);
  });

  test("counts the commands of a run, and each of its rows tops at the run", () => {
    const list = transcriptListItems(first, runRows, whole, classify);
    expect(list.items[2]).toMatchObject({
      kind: "tool_run",
      runKey: "s1",
      callCount: 3,
      kindCounts: { command: 3, read: 0, list: 0, search: 0, web: 0, tool: 0 },
      failedCount: 1,
    });
    // A jump to any command of the run lands on its card.
    expect(list.topItemOfRow.slice(1, 4)).toEqual([2, 2, 2]);
    expect(list.rowOfItem[2]).toBe(1);
  });

  test("puts a tool call between commands in their run, and a tool call alone in its own run", () => {
    const mixed = [
      shellRow("s1"),
      toolRow("mcp", "mcp__docs__search"),
      rows[0]!,
      toolRow("alone", "mcp__docs__search"),
    ];
    const list = transcriptListItems(first, mixed, whole, classify);
    expect(list.items.map((item) => item.key)).toEqual([
      "transcript:top-edge",
      "s1:tool-run",
      "a",
      "alone:tool-run",
      "transcript:bottom-edge",
    ]);
    expect(list.items[1]).toMatchObject({ callCount: 2, kindCounts: { command: 1, tool: 1 } });
    expect(list.items[3]).toMatchObject({ callCount: 1, kindCounts: { tool: 1 } });
  });

  test("settles a run whose calls all ended and that another row follows, so it can fold", () => {
    const settled = (list: TranscriptListItems) =>
      list.items.flatMap((item) => (item.kind === "tool_run" ? [[item.runKey, item.settled]] : []));
    expect(settled(transcriptListItems(first, runRows, whole, classify))).toEqual([
      ["s1", true],
      ["solo", false],
    ]);
    const running = [shellRow("s1", "running"), rows[0]!];
    expect(settled(transcriptListItems(first, running, whole, classify))).toEqual([["s1", false]]);
    // The last run settles once a row comes after it.
    const answered = [...runRows, rows[2]!];
    expect(settled(transcriptListItems(first, answered, whole, classify))).toEqual([
      ["s1", true],
      ["solo", true],
    ]);
  });

  test("keeps the item of an unchanged run, so its card does not render again", () => {
    const before = transcriptListItems(first, runRows, whole, classify).items;
    const after = transcriptListItems(first, [...runRows], whole, classify).items;
    expect(after[2]).toBe(before[2]);
    const changed = [...runRows];
    changed[2] = shellRow("s2");
    expect(transcriptListItems(first, changed, whole, classify).items[2]).not.toBe(before[2]);
  });
});
