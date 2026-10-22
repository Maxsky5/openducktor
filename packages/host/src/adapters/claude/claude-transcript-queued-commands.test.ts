import { describe, expect, test } from "bun:test";
import type { ClaudeProtocolObject, ClaudeProtocolValue } from "./claude-agent-sdk-ingress-schemas";
import { createClaudeTranscriptQueuedCommands } from "./claude-transcript-queued-commands";

type Row = ClaudeProtocolObject;

const queued = (uuid: string, attachment: Row = {}, parentUuid: string | null = "request") => ({
  type: "attachment",
  uuid,
  parentUuid,
  sessionId: "session",
  timestamp: "2026-10-21T12:00:00Z",
  attachment: { type: "queued_command", prompt: "queued prompt", ...attachment },
});

const request = { type: "user", uuid: "request", message: { content: "original request" } };
const reply = { type: "assistant", uuid: "reply", parentUuid: "request" };
const removed = (extra: Row) => ({
  type: "queue-operation",
  operation: "remove",
  reason: "absorbed_mid_turn",
  ...extra,
});

const normalize = (rows: readonly Row[], selected = new Set(rows.map((_, index) => index))) => {
  const collector = createClaudeTranscriptQueuedCommands();
  rows.forEach((row, index) => collector.observe(row, index));
  const project = collector.finish(selected);
  return rows.flatMap((row, index) => {
    if (!selected.has(index)) return [];
    const result = project(row, index);
    return result ? [result] : [];
  });
};

const queuedUsers = (rows: readonly Row[]) =>
  rows.filter((row) => row.type === "user" && row.isQueuedCommand === true);

describe("native Claude queued prompts", () => {
  test("projects an absorbed prompt with its source ID, envelope, and full text", () => {
    const prompt = "user text ".repeat(10_000);
    const rows = [
      request,
      queued("attachment", { prompt, source_uuid: "source", delivery_id: "delivery" }),
      removed({ deliveryId: "delivery" }),
    ];
    expect(queuedUsers(normalize(rows))).toEqual([
      {
        type: "user",
        uuid: "source",
        parentUuid: "request",
        sessionId: "session",
        timestamp: "2026-10-21T12:00:00Z",
        message: { role: "user", content: prompt },
        isMeta: false,
        isQueuedCommand: true,
        isReplay: true,
      },
    ]);
  });

  test("does not duplicate a canonical user record that occurs after its attachment", () => {
    const rows = [
      request,
      queued("attachment", { source_uuid: "canonical", delivery_id: "delivery" }),
      removed({ deliveryId: "delivery" }),
      {
        type: "user",
        uuid: "canonical",
        parentUuid: "request",
        message: { content: "canonical prompt" },
      },
      reply,
    ];
    expect(queuedUsers(normalize(rows))).toEqual([]);
    expect(queuedUsers(normalize(rows, new Set([0, 1, 2, 4])))).toHaveLength(1);
  });

  test("uses delivered copy IDs before reply inference for a repeated delivery", () => {
    const rows = [
      request,
      queued("early-copy", { source_uuid: "source", delivery_id: "delivery" }),
      queued("delivered-copy", { source_uuid: "source", delivery_id: "delivery" }),
      removed({ deliveryId: "delivery", commandUuid: "different-source" }),
      reply,
    ];
    const users = queuedUsers(normalize(rows));
    expect(users).toHaveLength(1);
    expect(users[0]?.uuid).toBe("source");
    expect(normalize(rows).some((row) => row.uuid === "early-copy")).toBe(false);
    expect(queuedUsers(normalize(rows, new Set([0, 1, 3, 4])))).toEqual([]);
  });

  test("counts command UUID removals for identical copies and avoids false copy proof for mixed prompts", () => {
    const first = queued("first", { source_uuid: "source", prompt: "first prompt" });
    const same = {
      ...queued("second", { source_uuid: "source", prompt: "first prompt" }),
      timestamp: "2026-10-21T12:01:00Z",
    };
    const identical = queuedUsers(
      normalize([request, first, same, removed({ commandUuid: "source" })]),
    );
    expect(identical).toHaveLength(1);
    expect(identical[0]?.timestamp).toBe("2026-10-21T12:01:00Z");
    const mixed = queued("second", { source_uuid: "source", prompt: "changed prompt" });
    const users = queuedUsers(
      normalize([request, first, mixed, removed({ commandUuid: "source" }), reply]),
    );
    expect(users).toHaveLength(1);
    expect(users[0]?.message).toEqual({ role: "user", content: "first prompt" });
  });

  test("infers reply delivery and keeps a selected trailing prompt attached to the conversation", () => {
    expect(queuedUsers(normalize([request, queued("before-reply"), reply]))).toHaveLength(1);
    expect(queuedUsers(normalize([request, reply, queued("trailing", {}, "reply")]))).toHaveLength(
      1,
    );
    expect(
      queuedUsers(
        normalize([
          request,
          queued("not-delivered"),
          { type: "user", uuid: "next", message: { content: "next prompt" } },
        ]),
      ),
    ).toEqual([]);
    expect(queuedUsers(normalize([queued("detached", {}, null)]))).toEqual([]);
  });

  test("preserves flags that let the history projector suppress meta and nonhuman prompts", () => {
    const users = queuedUsers(
      normalize([
        request,
        queued("meta", { isMeta: true, delivery_id: "meta" }),
        removed({ deliveryId: "meta" }),
        queued("notification", { commandMode: "task-notification", delivery_id: "notification" }),
        removed({ deliveryId: "notification" }),
        queued("observer", { origin: { kind: "observer" }, delivery_id: "observer" }),
        removed({ deliveryId: "observer" }),
        queued("forwarded", { forwardedIntent: { lineage: "owned" }, delivery_id: "forwarded" }),
        removed({ deliveryId: "forwarded" }),
      ]),
    );
    expect(users.map((row) => row.uuid)).toEqual(["meta", "notification", "observer"]);
    expect(users[0]?.isMeta).toBe(true);
    expect(users[1]?.origin).toEqual({ kind: "task-notification" });
    expect(users[2]?.origin).toEqual({ kind: "observer" });
  });

  const interruptionContents: ClaudeProtocolValue[] = [
    "[Request interrupted by user]",
    [{ type: "text", text: "[Request interrupted by user for tool use]" }],
    [{ type: "tool_result", is_error: true, content: "[Request interrupted by user]" }],
  ];
  test.each(interruptionContents.map((content) => ({ content })))(
    "keeps a queued prompt before an interruption reply",
    ({ content }) => {
      const users = queuedUsers(
        normalize([
          request,
          queued("queued-before-interruption"),
          { type: "user", uuid: "interruption", message: { content } },
        ]),
      );
      expect(users).toHaveLength(1);
    },
  );

  test("preserves structured prompt content and ignores unrelated attachment types", () => {
    const prompt = [
      { type: "text", text: "structured prompt" },
      { type: "image", source: { media_type: "image/png" } },
    ];
    const users = queuedUsers(
      normalize([
        request,
        queued("structured", { prompt, delivery_id: "delivery" }),
        removed({ deliveryId: "delivery" }),
        { type: "attachment", uuid: "snapshot", attachment: { type: "file_history_snapshot" } },
      ]),
    );
    expect(users).toHaveLength(1);
    expect(users[0]?.message).toEqual({ role: "user", content: prompt });
  });
});
