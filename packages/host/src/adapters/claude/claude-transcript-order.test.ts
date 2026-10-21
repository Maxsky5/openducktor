import { describe, expect, test } from "bun:test";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import {
  readClaudeTranscriptOrderMetadata,
  selectClaudeTranscriptEntries,
} from "./claude-transcript-order";

type Row = ClaudeProtocolObject;

const user = (uuid: string, parentUuid: string | null, extra: Row = {}) => ({
  type: "user",
  uuid,
  parentUuid,
  message: { role: "user", content: uuid },
  ...extra,
});

const assistant = (uuid: string, parentUuid: string, extra: Row = {}) => ({
  type: "assistant",
  uuid,
  parentUuid,
  message: { id: uuid, role: "assistant", content: [{ type: "text", text: uuid }] },
  ...extra,
});

const boundary = (uuid: string, extra: Row = {}) => ({
  type: "system",
  subtype: "compact_boundary",
  uuid,
  parentUuid: null,
  ...extra,
});

const select = (rows: readonly Row[], includeSidechains = false): number[] => [
  ...selectClaudeTranscriptEntries(rows.map(readClaudeTranscriptOrderMetadata), {
    includeSidechains,
  }),
];

describe("Claude transcript archive selection", () => {
  test("keeps the active history before each reached compaction in source order", () => {
    const rows = [
      user("original", null),
      assistant("original-reply", "original"),
      boundary("compact-1"),
      user("summary-1", "compact-1", { isCompactSummary: true }),
      assistant("continued", "summary-1"),
      boundary("compact-2"),
      user("summary-2", "compact-2", { isCompactSummary: true }),
      assistant("latest", "summary-2"),
    ];
    expect(select(rows)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("omits a compacted branch when a later rewind bypasses its boundary", () => {
    const rows = [
      user("request", null),
      assistant("discarded-reply", "request"),
      boundary("discarded-compact"),
      user("discarded-summary", "discarded-compact", { isCompactSummary: true }),
      assistant("discarded-tail", "discarded-summary"),
      assistant("replacement", "request"),
    ];
    expect(select(rows)).toEqual([0, 5]);
  });

  test("uses the latest payload for a UUID retained by an archived prefix", () => {
    const rows = [
      user("request", null),
      assistant("original-reply", "request"),
      boundary("compact"),
      user("summary", "compact", { isCompactSummary: true }),
      assistant("continued", "summary"),
      assistant("original-reply", "request"),
      assistant("latest", "continued"),
    ];
    expect(select(rows)).toEqual([0, 2, 3, 4, 5, 6]);
  });

  test("uses the last UUID occurrence and a trailing system parent to select a branch", () => {
    const rows = [
      user("request", null),
      assistant("old", "request", { timestamp: "2099-01-01T00:00:00Z" }),
      assistant("replacement", "request", { timestamp: "2000-01-01T00:00:00Z" }),
      assistant("old", "request", { timestamp: "1999-01-01T00:00:00Z" }),
      { type: "system", subtype: "notice", uuid: "notice", parentUuid: "replacement" },
    ];
    expect(select(rows)).toEqual([0, 2, 4]);
    expect(select(rows.slice(0, 4))).toEqual([0, 3]);
  });

  test.each(["preservedMessages", "preservedSegment"] as const)(
    "restores %s entries that the prior active branch did not retain",
    (kind) => {
      const preserved =
        kind === "preservedMessages"
          ? { preservedMessages: { anchorUuid: "compact", uuids: ["kept-1", "kept-2"] } }
          : {
              preservedSegment: {
                anchorUuid: "compact",
                headUuid: "kept-1",
                tailUuid: "kept-2",
              },
            };
      const rows = [
        user("request", null),
        assistant("kept-1", "request"),
        assistant("kept-2", "kept-1"),
        assistant("prior-active", "request"),
        boundary("compact", { compactMetadata: preserved }),
        user("summary", "compact", { isCompactSummary: true }),
        assistant("tail", "summary"),
      ];
      expect(select(rows)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    },
  );

  test("does not substitute preservedSegment when preservedMessages names a missing UUID", () => {
    const rows = [
      user("request", null),
      assistant("discarded", "request"),
      assistant("prior-active", "request"),
      boundary("compact", {
        compactMetadata: {
          preservedMessages: { anchorUuid: "compact", uuids: ["missing"] },
          preservedSegment: {
            anchorUuid: "compact",
            headUuid: "discarded",
            tailUuid: "discarded",
          },
        },
      }),
      user("summary", "compact", { isCompactSummary: true }),
      assistant("tail", "summary"),
    ];
    expect(select(rows)).toEqual([0, 2, 3, 4, 5]);
  });

  test("keeps parallel assistant fragments and their tool results without reordering them", () => {
    const rows = [
      user("request", null),
      assistant("call-1", "request", {
        message: { id: "response", content: [{ type: "tool_use", id: "tool-1" }] },
      }),
      assistant("call-2", "request", {
        message: { id: "response", content: [{ type: "tool_use", id: "tool-2" }] },
      }),
      user("result-1", "call-1", {
        message: { content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
      }),
      user("result-2", "call-2", {
        message: { content: [{ type: "tool_result", tool_use_id: "tool-2" }] },
      }),
      user("result-copy", "request", {
        sourceToolAssistantUUID: "call-1",
        message: { content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
      }),
      assistant("final", "result-2"),
    ];
    expect(select(rows)).toEqual([0, 1, 2, 3, 4, 6]);
  });

  test("omits a stale tool result whose parent is a retained user request", () => {
    const rows = [
      user("request", null),
      assistant("discarded-call", "request", {
        message: { id: "discarded", content: [{ type: "tool_use", id: "discarded-tool" }] },
      }),
      user("discarded-result", "request", {
        sourceToolAssistantUUID: "discarded-call",
        message: { content: [{ type: "tool_result", tool_use_id: "discarded-tool" }] },
      }),
      assistant("replacement", "request"),
    ];
    expect(select(rows)).toEqual([0, 3]);
  });

  test("does not let a direct result from another response hide an original tool result", () => {
    const rows = [
      user("request", null),
      assistant("call", "request", {
        message: { id: "call-response", content: [{ type: "tool_use", id: "tool" }] },
      }),
      assistant("followup", "call"),
      user("original-result", "request", {
        message: { content: [{ type: "tool_result", tool_use_id: "tool" }] },
      }),
      user("late-result", "followup", {
        message: { content: [{ type: "tool_result", tool_use_id: "tool" }] },
      }),
      assistant("final", "followup"),
    ];
    expect(select(rows)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("omits a discarded human turn after a shared assistant ancestor", () => {
    const rows = [
      user("request", null),
      assistant("shared-reply", "request"),
      user("discarded-followup", "shared-reply"),
      assistant("discarded-reply", "discarded-followup"),
      user("replacement-followup", "shared-reply"),
      assistant("replacement-reply", "replacement-followup"),
    ];
    expect(select(rows)).toEqual([0, 1, 4, 5]);
  });

  test("keeps retraction events after the messages that the projector must retract", () => {
    const rows = [
      user("request", null),
      assistant("refused", "request"),
      assistant("canonical", "refused", { supersedes: ["refused"] }),
      { type: "result", retracted_message_uuids: ["refused"] },
      {
        type: "system",
        subtype: "model_refusal_fallback",
        uuid: "retraction",
        parentUuid: "canonical",
        retracted_message_uuids: ["refused"],
      },
    ];
    expect(select(rows)).toEqual([0, 1, 2, 3, 4]);
  });

  test("keeps unlinked events only in retained conversation segments", () => {
    const rows = [
      { type: "queue-operation", operation: "enqueue", content: "request" },
      user("request", null),
      assistant("discarded", "request"),
      { type: "result", result: "discarded result" },
      assistant("replacement", "request"),
      { type: "result", result: "retained result" },
    ];
    expect(select(rows)).toEqual([0, 1, 4, 5]);
  });

  test("reads selected sidechain files while excluding sidechain and team leaves from main history", () => {
    const main = [
      user("request", null),
      assistant("main", "request"),
      assistant("child", "request", { isSidechain: true, agentId: "child" }),
      assistant("team", "request", { teamName: "team" }),
      { type: "progress", uuid: "progress", parentUuid: "request" },
      {
        type: "attachment",
        uuid: "briefing",
        parentUuid: "request",
        attachment: { type: "fork_briefing" },
      },
    ];
    expect(select(main).filter((index) => main[index]?.type === "assistant")).toEqual([1]);
    const child = [
      user("child-request", null, { isSidechain: true, agentId: "child" }),
      assistant("child-reply", "child-request", { isSidechain: true, agentId: "child" }),
    ];
    expect(select(child, true)).toEqual([0, 1]);
    expect(select(child)).toEqual([]);
  });

  test("keeps link-free public message fixtures and resolves their duplicate UUIDs", () => {
    const rows = [
      { type: "user", uuid: "request" },
      { type: "assistant", uuid: "reply" },
      { type: "result" },
      { type: "assistant", uuid: "reply" },
    ];
    expect(select(rows)).toEqual([0, 2, 3]);
  });

  test("keeps only IDs from message payloads in graph metadata", () => {
    const metadata = readClaudeTranscriptOrderMetadata({
      type: "assistant",
      uuid: "assistant",
      parentUuid: "request",
      message: {
        id: "response",
        content: [
          { type: "text", text: "large text payload" },
          { type: "tool_use", id: "tool", input: { content: "large input payload" } },
          { type: "tool_result", tool_use_id: "prior-tool", content: "large output payload" },
        ],
      },
    });
    expect(metadata.responseId).toBe("response");
    expect(metadata.toolUseIds).toEqual(["tool"]);
    expect(metadata.toolResultIds).toEqual(["prior-tool"]);
    expect(JSON.stringify(metadata)).not.toContain("payload");
  });
});
