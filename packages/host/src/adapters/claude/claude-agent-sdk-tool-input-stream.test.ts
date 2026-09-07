import { describe, expect, spyOn, test } from "bun:test";
import {
  appendClaudeStreamToolInputJson,
  completeClaudeStreamToolInput,
  consumeClaudeStreamEmittedToolInput,
  rememberClaudeStreamToolStart,
  discardClaudeStreamToolInputBlocks,
  clearClaudeStreamToolInputTree,
} from "./claude-agent-sdk-tool-input-stream";

const start = (session: { externalSessionId: string }, index: number, callId: string) =>
  rememberClaudeStreamToolStart(session, index, {
    blockType: "tool_use",
    callId,
    input: {},
    toolName: "Write",
  });

describe("Claude streamed tool input", () => {
  test("parses a large fragmented object once at completion and preserves escaped content", () => {
    const session = { externalSessionId: "session-1" };
    const input = { content: "x".repeat(262144) };
    const json = JSON.stringify(input);
    expect(json.length).toBe(262158);
    start(session, 1, "tool-1");
    const parse = spyOn(JSON, "parse");
    try {
      for (let offset = 0; offset < json.length; offset += 64) {
        appendClaudeStreamToolInputJson(session, 1, json.slice(offset, offset + 64));
      }
      expect(parse).not.toHaveBeenCalled();
      expect(completeClaudeStreamToolInput(session, 1)).toMatchObject({ callId: "tool-1", input });
      expect(parse).toHaveBeenCalledTimes(1);
      expect(parse).toHaveBeenCalledWith(json);
      expect(completeClaudeStreamToolInput(session, 1)).toBeNull();
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
    expect(consumeClaudeStreamEmittedToolInput(session, "tool-1", input)).toBe(true);
    expect(consumeClaudeStreamEmittedToolInput(session, "tool-1", input)).toBe(false);

    const escaped = { content: 'braces {} and "quotes", \\ slash\nline', nested: [{ ok: true }] };
    start(session, 1, "escaped");
    for (const chunk of JSON.stringify(escaped)) {
      appendClaudeStreamToolInputJson(session, 1, chunk);
    }
    expect(completeClaudeStreamToolInput(session, 1)?.input).toEqual(escaped);
  });

  test("keeps interleaved blocks and reused indexes separate from old envelopes", () => {
    const session = { externalSessionId: "session-1" };
    start(session, 0, "first");
    start(session, 1, "second");
    appendClaudeStreamToolInputJson(session, 0, '{"value":');
    appendClaudeStreamToolInputJson(session, 1, '{"value":2}');
    appendClaudeStreamToolInputJson(session, 0, "1}");
    expect(completeClaudeStreamToolInput(session, 0)?.input).toEqual({ value: 1 });
    start(session, 0, "third");
    appendClaudeStreamToolInputJson(session, 0, '{"value":3}');
    expect(consumeClaudeStreamEmittedToolInput(session, "first", { value: 1 })).toBe(true);
    expect(completeClaudeStreamToolInput(session, 0)).toMatchObject({
      callId: "third",
      input: { value: 3 },
    });
    expect(completeClaudeStreamToolInput(session, 1)).toMatchObject({
      callId: "second",
      input: { value: 2 },
    });
    expect(consumeClaudeStreamEmittedToolInput(session, "third", { value: 4 })).toBe(false);
  });

  test("keeps early envelopes attached to interleaved calls and releases them at stop", () => {
    const session = { externalSessionId: "session-1" };
    start(session, 0, "first");
    start(session, 1, "second");
    appendClaudeStreamToolInputJson(session, 0, '{"value":1}');
    appendClaudeStreamToolInputJson(session, 1, '{"value":2}');
    expect(consumeClaudeStreamEmittedToolInput(session, "second", { value: 20 })).toBe(true);
    expect(consumeClaudeStreamEmittedToolInput(session, "first", { value: 10 })).toBe(true);
    expect(completeClaudeStreamToolInput(session, 0)).toMatchObject({
      callId: "first",
      input: { value: 10 },
    });
    start(session, 0, "third");
    appendClaudeStreamToolInputJson(session, 0, '{"value":3}');
    expect(consumeClaudeStreamEmittedToolInput(session, "first", { value: 10 })).toBe(false);
    expect(completeClaudeStreamToolInput(session, 1)).toMatchObject({
      callId: "second",
      input: { value: 20 },
    });
    expect(completeClaudeStreamToolInput(session, 0)).toMatchObject({
      callId: "third",
      input: { value: 3 },
    });
  });

  test("uses an early envelope for a block without deltas and clears it on cancellation", () => {
    const session = { externalSessionId: "session-1" };
    start(session, 0, "empty");
    expect(consumeClaudeStreamEmittedToolInput(session, "empty", { default: true })).toBe(true);
    expect(completeClaudeStreamToolInput(session, 0)?.input).toEqual({ default: true });
    expect(consumeClaudeStreamEmittedToolInput(session, "empty", { default: true })).toBe(false);
    start(session, 0, "canceled");
    appendClaudeStreamToolInputJson(session, 0, '{"value":');
    expect(consumeClaudeStreamEmittedToolInput(session, "canceled", { value: 1 })).toBe(true);
    clearClaudeStreamToolInputTree(session);
    expect(completeClaudeStreamToolInput(session, 0)).toBeNull();
    expect(consumeClaudeStreamEmittedToolInput(session, "canceled", { value: 1 })).toBe(false);
  });

  test.each(['{"broken":', "[]", "null", '"string"', "1"])(
    "rejects malformed completed input %s once",
    (json) => {
      const session = { externalSessionId: "session-1" };
      start(session, 0, "invalid");
      appendClaudeStreamToolInputJson(session, 0, json);
      const parse = spyOn(JSON, "parse");
      try {
        expect(() => completeClaudeStreamToolInput(session, 0)).toThrow('tool input for "invalid"');
        expect(parse).toHaveBeenCalledTimes(1);
        expect(completeClaudeStreamToolInput(session, 0)).toBeNull();
        expect(consumeClaudeStreamEmittedToolInput(session, "invalid", {})).toBe(false);
      } finally {
        parse.mockRestore();
      }
    },
  );

  test("does not parse empty deltas or repeat unchanged initial input", () => {
    const session = { externalSessionId: "session-1" };
    start(session, 0, "empty");
    appendClaudeStreamToolInputJson(session, 0, "");
    const parse = spyOn(JSON, "parse");
    try {
      expect(completeClaudeStreamToolInput(session, 0)).toBeNull();
      expect(parse).not.toHaveBeenCalled();
      expect(consumeClaudeStreamEmittedToolInput(session, "empty", {})).toBe(true);
      start(session, 0, "object");
      appendClaudeStreamToolInputJson(session, 0, "{}");
      expect(completeClaudeStreamToolInput(session, 0)).toBeNull();
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });

  test("discards incomplete blocks at a message boundary but retains completed deduplication", () => {
    const session = { externalSessionId: "session-1" };
    start(session, 0, "completed");
    appendClaudeStreamToolInputJson(session, 0, '{"value":1}');
    completeClaudeStreamToolInput(session, 0);
    start(session, 1, "incomplete");
    appendClaudeStreamToolInputJson(session, 1, '{"value":');
    discardClaudeStreamToolInputBlocks(session);
    expect(completeClaudeStreamToolInput(session, 1)).toBeNull();
    expect(consumeClaudeStreamEmittedToolInput(session, "incomplete", {})).toBe(false);
    expect(consumeClaudeStreamEmittedToolInput(session, "completed", { value: 1 })).toBe(true);
  });

  test("clears parent and child input without parsing interrupted JSON", () => {
    const child = { externalSessionId: "child" };
    const session = {
      externalSessionId: "parent",
      subagentEventSessionsByToolUseId: new Map([["child", child]]),
    };
    for (const target of [session, child]) {
      start(target, 0, "interrupted");
      appendClaudeStreamToolInputJson(target, 0, '{"value":');
    }
    const parse = spyOn(JSON, "parse");
    try {
      clearClaudeStreamToolInputTree(session);
      for (const target of [session, child]) {
        expect(completeClaudeStreamToolInput(target, 0)).toBeNull();
        expect(consumeClaudeStreamEmittedToolInput(target, "interrupted", {})).toBe(false);
      }
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
});
