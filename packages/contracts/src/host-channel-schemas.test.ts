import { describe, expect, test } from "bun:test";
import {
  encodeHostChannelFrame,
  hostChannelMessageSchema,
  hostChannelRequestSchema,
  hostEventsOpenedSchema,
  splitHostChannelFrame,
} from "./host-channel-schemas";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("host channel frames", () => {
  test("round trips a header without a body", () => {
    const frame = splitHostChannelFrame(encodeHostChannelFrame({ type: "heartbeat" }));

    expect(JSON.parse(frame.header)).toEqual({ type: "heartbeat" });
    expect(frame.body).toBeNull();
  });

  test("keeps a body with line feeds as encoded bytes after the first line feed", () => {
    const body = '{"text":"line one\\nline two"}\n';
    const frame = splitHostChannelFrame(
      encodeHostChannelFrame({ type: "host_event", id: 3, name: "message" }, body),
    );

    expect(JSON.parse(frame.header)).toEqual({ type: "host_event", id: 3, name: "message" });
    expect(frame.body).toBeInstanceOf(Uint8Array);
    expect(decode(frame.body ?? new Uint8Array())).toBe(body);
  });

  test("rejects a header that is not UTF-8", () => {
    expect(() => splitHostChannelFrame(new Uint8Array([0xff, 0xfe]))).toThrow();
  });
});

describe("host channel schemas", () => {
  test("accepts each request method and rejects unknown fields", () => {
    const cursor = { epoch: crypto.randomUUID(), sequence: 1 };
    const subscriptionId = crypto.randomUUID();
    const requests = [
      { method: "events.open", cursor: null, notificationCursor: null },
      { method: "invoke", command: "git_check", args: {} },
      { method: "task_events.subscribe", input: { cursor: null } },
      { method: "task_events.attach", subscriptionId },
      { method: "task_events.ack", subscriptionId, cursor },
      { method: "task_events.release", subscriptionId },
      { method: "remote_access.observe" },
      { method: "remote_access.unobserve" },
    ];
    for (const [id, request] of requests.entries())
      expect(hostChannelRequestSchema.safeParse({ type: "request", id, ...request }).success).toBe(
        true,
      );

    expect(
      hostChannelRequestSchema.safeParse({
        type: "request",
        id: 1,
        method: "remote_access.observe",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      hostChannelRequestSchema.safeParse({
        type: "request",
        id: -1,
        method: "remote_access.observe",
      }).success,
    ).toBe(false);
    expect(
      hostChannelRequestSchema.safeParse({
        type: "request",
        id: 1,
        method: "task_events.attach",
        subscriptionId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  test("accepts host messages and rejects an unknown error kind", () => {
    expect(hostChannelMessageSchema.safeParse({ type: "result", id: 1 }).success).toBe(true);
    expect(
      hostChannelMessageSchema.safeParse({
        type: "error",
        id: 1,
        error: { kind: "reply_too_large", limitBytes: 1024 },
      }).success,
    ).toBe(true);
    expect(
      hostChannelMessageSchema.safeParse({
        type: "error",
        id: 1,
        error: { kind: "lost" },
      }).success,
    ).toBe(false);
    expect(
      hostChannelMessageSchema.safeParse({ type: "host_event", id: 0, name: "message" }).success,
    ).toBe(false);
  });

  test("requires the host event ID in the opened result", () => {
    const opened = { hostEpoch: "epoch", hostChanged: false, gaps: [] };

    expect(hostEventsOpenedSchema.safeParse(opened).success).toBe(false);
    expect(hostEventsOpenedSchema.safeParse({ ...opened, hostEventId: 4 }).success).toBe(true);
  });
});
