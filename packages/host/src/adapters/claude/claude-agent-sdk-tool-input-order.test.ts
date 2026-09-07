import { describe, expect, spyOn, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

const timestamp = "2026-09-08T00:00:00.000Z";

describe("Claude tool input completion order", () => {
  test.each(["envelope-first", "stop-first"] as const)(
    "%s parses large fragmented input once and emits one completed update",
    (order) => {
      const session = createEventTestSession();
      const events: AgentEvent[] = [];
      const send = (message: ReturnType<typeof claudeSdkMessageFixture>) =>
        handleClaudeSdkMessage({
          session,
          message,
          timestamp,
          modelSelection: (model) => ({
            providerId: "claude",
            modelId: model,
            runtimeKind: "claude",
          }),
          emit: (event) => events.push(event),
        });
      const input = { content: "x".repeat(262144) };
      const json = JSON.stringify(input);
      expect(json.length).toBe(262158);
      send(
        claudeSdkMessageFixture({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 2,
            content_block: { type: "tool_use", id: "write-1", name: "Write", input: {} },
          },
        }),
      );
      const parse = spyOn(JSON, "parse");
      try {
        for (let offset = 0; offset < json.length; offset += 64) {
          send(
            claudeSdkMessageFixture({
              type: "stream_event",
              event: {
                type: "content_block_delta",
                index: 2,
                delta: { type: "input_json_delta", partial_json: json.slice(offset, offset + 64) },
              },
            }),
          );
        }
        expect(parse).not.toHaveBeenCalled();
        expect(events).toHaveLength(1);
        const envelope = claudeSdkMessageFixture({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "write-1", name: "Write", input }],
          },
        });
        const stop = claudeSdkMessageFixture({
          type: "stream_event",
          event: { type: "content_block_stop", index: 2 },
        });
        if (order === "envelope-first") {
          send(envelope);
          expect(parse).not.toHaveBeenCalled();
          expect(events).toHaveLength(1);
          send(stop);
        } else {
          send(stop);
          send(envelope);
        }
        send(stop);
        expect(parse).toHaveBeenCalledTimes(1);
        expect(parse).toHaveBeenCalledWith(json);
        expect(events).toHaveLength(2);
        for (const event of events) {
          expect(event).toMatchObject({
            type: "assistant_part",
            part: {
              kind: "tool",
              callId: "write-1",
              partId: "write-1",
              messageId: "write-1",
              status: "pending",
            },
          });
        }
        expect(session.toolInputsByCallId.get("write-1")).toEqual(input);
      } finally {
        parse.mockRestore();
      }
    },
  );

  test.each(["envelope-first", "stop-first"] as const)(
    "%s preserves SDK-normalized final values",
    (order) => {
      const session = createEventTestSession();
      const send = (message: ReturnType<typeof claudeSdkMessageFixture>) =>
        handleClaudeSdkMessage({
          session,
          message,
          timestamp,
          modelSelection: (model) => ({
            providerId: "claude",
            modelId: model,
            runtimeKind: "claude",
          }),
          emit: () => {},
        });
      send(
        claudeSdkMessageFixture({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "write-1", name: "Write", input: {} },
          },
        }),
      );
      send(
        claudeSdkMessageFixture({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path":"relative.txt","content":"{}"}',
            },
          },
        }),
      );
      const input = { file_path: "/repo/relative.txt", content: "{}" };
      const envelope = claudeSdkMessageFixture({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "write-1", name: "Write", input }],
        },
      });
      const stop = claudeSdkMessageFixture({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      });
      for (const message of order === "envelope-first" ? [envelope, stop] : [stop, envelope]) {
        send(message);
      }
      expect(session.toolInputsByCallId.get("write-1")).toEqual(input);
    },
  );
});
