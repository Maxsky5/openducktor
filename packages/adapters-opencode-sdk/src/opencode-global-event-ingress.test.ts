import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { normalizeOpencodeGlobalEventPayload } from "./opencode-agent-session-projection";
import {
  OPENCODE_EVENT_POLICY_BY_TYPE,
  isConsumedOpencodeEventType,
} from "./opencode-event-policy";
import {
  opencodeDirectEventSchema,
  parseOpencodeGlobalEventPayload,
} from "./opencode-global-event-ingress";

describe("type-directed OpenCode ingress", () => {
  test("keeps every explicit ignored event policy", () => {
    for (const type of Object.keys(OPENCODE_EVENT_POLICY_BY_TYPE)) {
      if (isConsumedOpencodeEventType(type)) continue;
      expect(
        parseOpencodeGlobalEventPayload({
          id: "ignored",
          type,
          properties: { future: [1, false] },
        }),
      ).toEqual({
        id: "ignored",
        type,
        kind: "ignored",
      });
    }
  });

  test("rejects malformed consumed events instead of treating them as ignored", () => {
    for (const schema of opencodeDirectEventSchema.options) {
      const type = schema.shape.type.value;
      expect(() => parseOpencodeGlobalEventPayload({ type, properties: {} })).toThrow(
        `Invalid OpenCode global event payload (${type})`,
      );
    }
    expect(() =>
      parseOpencodeGlobalEventPayload({
        id: "delta",
        type: "message.part.delta",
        properties: {
          sessionID: "session",
          messageID: "message",
          partID: "part",
          field: "text",
          delta: 1,
        },
      }),
    ).toThrow("properties.delta");
  });

  test("preserves direct outputs and stripping when selecting a variant", () => {
    const previous = z.union(opencodeDirectEventSchema.options);
    for (const event of [
      {
        id: "delta",
        type: "message.part.delta",
        properties: {
          sessionID: "s",
          messageID: "m",
          partID: "p",
          field: "text",
          delta: "hello",
          directory: "/repo",
          extra: true,
        },
      },
      {
        id: "status",
        type: "session.status",
        properties: { sessionID: "s", status: { type: "busy" }, extra: true },
      },
    ]) {
      expect(opencodeDirectEventSchema.parse(event)).toEqual(previous.parse(event));
    }
  });

  test("compiled deltas strip unknown keys and retain the directory", () => {
    expect(
      opencodeDirectEventSchema.parse({
        id: "delta",
        type: "message.part.delta",
        extra: true,
        properties: {
          sessionID: "s",
          messageID: "m",
          partID: "p",
          field: "text",
          delta: "hello",
          directory: "/repo",
          extra: true,
        },
      }),
    ).toEqual({
      id: "delta",
      type: "message.part.delta",
      properties: {
        sessionID: "s",
        messageID: "m",
        partID: "p",
        field: "text",
        delta: "hello",
        directory: "/repo",
      },
    });
  });

  test("validates heartbeat and sync envelopes before normalization", () => {
    expect(
      normalizeOpencodeGlobalEventPayload({
        id: "heartbeat",
        type: "server.heartbeat",
        properties: {},
      }),
    ).toEqual({ kind: "heartbeat" });
    expect(() =>
      parseOpencodeGlobalEventPayload({
        id: "heartbeat",
        type: "server.heartbeat",
        properties: null,
      }),
    ).toThrow("Invalid OpenCode global event payload");
    expect(() =>
      normalizeOpencodeGlobalEventPayload({
        id: "sync",
        type: "sync",
        syncEvent: {
          id: "event",
          seq: 1,
          type: "session.updated.99",
          aggregateID: "s",
          data: {},
        },
      }),
    ).toThrow("has no normalization decision");
    expect(() =>
      parseOpencodeGlobalEventPayload({
        id: "sync",
        type: "sync",
        syncEvent: {
          id: "event",
          seq: 1,
          type: "session.updated.1",
          aggregateID: "s",
          data: null,
        },
      }),
    ).toThrow("syncEvent.data");
  });
});
