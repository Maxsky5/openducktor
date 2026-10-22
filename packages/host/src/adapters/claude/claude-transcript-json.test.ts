import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  type ClaudeProtocolObject,
  type ClaudeProtocolValue,
} from "./claude-agent-sdk-ingress-schemas";
import {
  ClaudeTranscriptJsonError,
  createClaudeTranscriptJsonReader as createProductionReader,
} from "./claude-transcript-json";

const createClaudeTranscriptJsonReader = (
  options: Parameters<typeof createProductionReader>[0] = {},
) => {
  const reader = createProductionReader(options);
  const chunks: string[] = [];
  return {
    write: (chunk: string): void => {
      chunks.push(chunk);
      reader.write(chunk);
    },
    finish: (): ClaudeProtocolObject | null => {
      const first = reader.finish();
      if (first.kind === "complete") return first.record;
      for (const chunk of chunks) first.reader.write(chunk);
      const second = first.reader.finish();
      if (second.kind !== "complete") throw new Error("Expected at most one source replay");
      return second.record;
    },
  };
};

const readRecord = (record: ClaudeProtocolValue, chunkSize = 17): ClaudeProtocolObject | null => {
  const json = JSON.stringify(record);
  const reader = createClaudeTranscriptJsonReader();
  for (let index = 0; index < json.length; index += chunkSize)
    reader.write(json.slice(index, index + chunkSize));
  return reader.finish();
};

describe("Claude transcript JSON reader", () => {
  test("requests one source replay for an oversized record and completes its second pass", () => {
    const chunks = [
      '{"type":"user","uuid":"user-1","isVisibleInTranscriptOnly":true,"snapshots":"',
      "A".repeat(3 * 1024 * 1024),
      '","message":{"content":"Keep this text."}}',
    ];
    const reader = createProductionReader();
    for (const chunk of chunks) reader.write(chunk);
    const first = reader.finish();
    expect(first.kind).toBe("replay");
    if (first.kind !== "replay") throw new Error("Expected an oversized record to request replay");
    for (const chunk of chunks) first.reader.write(chunk);
    expect(first.reader.finish()).toEqual({
      kind: "complete",
      record: {
        type: "user",
        uuid: "user-1",
        isVisibleInTranscriptOnly: true,
        message: { content: "Keep this text." },
      },
    });
  });

  test("rejects changed source bytes during replay even when the source length stays the same", () => {
    const prefix = '{"type":"user","snapshots":"';
    const snapshots = "A".repeat(3 * 1024 * 1024);
    const suffix = '","message":{"content":"Keep this text."}}';
    const reader = createProductionReader();
    for (const chunk of [prefix, snapshots, suffix]) reader.write(chunk);
    const first = reader.finish();
    expect(first.kind).toBe("replay");
    if (first.kind !== "replay") throw new Error("Expected an oversized record to request replay");
    for (const chunk of [prefix, `B${snapshots.slice(1)}`, suffix]) first.reader.write(chunk);
    try {
      first.reader.finish();
      throw new Error("Expected changed source to fail replay");
    } catch (cause) {
      if (!(cause instanceof ClaudeTranscriptJsonError)) throw cause;
      expect(cause.reason).toBe("changed");
    }
  });

  test("retains conversation text, attachment positions, and chain metadata without binary payloads", () => {
    const record = {
      type: "user",
      uuid: "user-1",
      parentUuid: "assistant-0",
      logicalParentUuid: "original-parent",
      sessionId: "session-1",
      cwd: "/repo",
      timestamp: "2026-10-21T10:00:00.000Z",
      isVisibleInTranscriptOnly: true,
      message: {
        role: "user",
        content: [
          { type: "text", text: "Inspect @src/main.ts" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "x".repeat(500_000) },
          },
          {
            type: "document",
            title: "Plan",
            source: { media_type: "application/pdf", data: "y".repeat(500_000) },
          },
          { type: "text", text: "Keep this block index." },
        ],
      },
      snapshots: "z".repeat(500_000),
    };
    expect(readRecord(record, 8192)).toEqual({
      type: "user",
      uuid: "user-1",
      parentUuid: "assistant-0",
      logicalParentUuid: "original-parent",
      sessionId: "session-1",
      cwd: "/repo",
      timestamp: "2026-10-21T10:00:00.000Z",
      isVisibleInTranscriptOnly: true,
      message: {
        role: "user",
        content: [
          { type: "text", text: "Inspect @src/main.ts" },
          { type: "image", source: { media_type: "image/png" } },
          { type: "document", title: "Plan", source: { media_type: "application/pdf" } },
          { type: "text", text: "Keep this block index." },
        ],
      },
    });
  });

  test("reads a discarded base64 string in repeated chunks without retaining it", () => {
    const reader = createClaudeTranscriptJsonReader();
    reader.write('{"type":"user","message":{"content":[{"type":"image","source":{"data":"');
    const chunk = "A".repeat(8192);
    for (let index = 0; index < 4096; index++) reader.write(chunk);
    reader.write('","media_type":"image/png"}}]},"uuid":"image-user"}');
    expect(reader.finish()).toEqual({
      type: "user",
      message: { content: [{ type: "image", source: { media_type: "image/png" } }] },
      uuid: "image-user",
    });
  });

  test("limits tool-result text to 64 KiB including a visible original-size marker", () => {
    const text = "a😀é\n".repeat(20_000);
    const result = readRecord(
      {
        type: "user",
        uuid: "tool-result",
        message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: text }] },
      },
      8191,
    );
    const message = z
      .object({ content: z.array(z.object({ content: z.string() })) })
      .parse(result!.message);
    const content = message.content[0]!.content;
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(64 * 1024);
    expect(content.startsWith("a😀é\n")).toBe(true);
    expect(content).toEndWith(
      `[Claude tool output truncated; original size: ${Buffer.byteLength(text)} UTF-8 bytes]`,
    );
    expect(content).not.toContain("�");
  });

  test.each(["😀", "\ud800"])(
    "keeps the retained prefix intact when the bounded source slice ends with a surrogate: %s",
    (surrogate) => {
      const text = "a".repeat(65_535) + surrogate + "tail".repeat(20_000);
      const result = readRecord({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: text }] },
      });
      const message = z
        .object({ content: z.array(z.object({ content: z.string() })) })
        .parse(result!.message);
      const content = message.content[0]!.content;
      const marker = `\n[Claude tool output truncated; original size: ${Buffer.byteLength(text)} UTF-8 bytes]`;
      expect(content).toBe("a".repeat(64 * 1024 - Buffer.byteLength(marker)) + marker);
    },
  );

  test("keeps complete tool input, file diffs, todos, and child links", () => {
    const fileContent = "line\n".repeat(20_000);
    const input = {
      file_path: "/repo/file.ts",
      old_string: fileContent,
      new_string: `${fileContent}new line\n`,
      content: fileContent,
      custom: { signature: "input signature", source: { data: "tool-owned data" } },
      todos: [{ content: "Inspect file", status: "in_progress", activeForm: "Inspecting file" }],
    };
    expect(
      readRecord(
        {
          type: "assistant",
          uuid: "edit-1",
          message: { content: [{ type: "tool_use", id: "call-1", name: "Edit", input }] },
        },
        8192,
      ),
    ).toEqual({
      type: "assistant",
      uuid: "edit-1",
      message: { content: [{ type: "tool_use", id: "call-1", name: "Edit", input }] },
    });
    const toolUseResult = {
      type: "create",
      content: fileContent,
      filePath: "/repo/file.ts",
      structuredPatch: [
        { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ["+new line"] },
      ],
      task: { id: "1", subject: "Inspect file", status: "completed" },
      agentId: "child-1",
      backgroundTaskId: "child-task-1",
    };
    expect(
      readRecord(
        {
          type: "user",
          uuid: "edit-result",
          toolUseResult,
          message: {
            content: [{ type: "tool_result", tool_use_id: "call-1", content: "File written" }],
          },
        },
        8192,
      )?.toolUseResult,
    ).toEqual(toolUseResult);
  });

  test("keeps full assistant text and thinking while removing unused signatures", () => {
    const text = "Keep all assistant text. ".repeat(4000);
    expect(
      readRecord(
        {
          type: "assistant",
          message: {
            id: "message-1",
            model: "claude-opus",
            stop_reason: "end_turn",
            content: [
              { type: "thinking", thinking: "Reasoning", signature: "signed".repeat(100_000) },
              { type: "redacted_thinking", data: "secret".repeat(100_000) },
              { type: "text", text },
            ],
          },
        },
        8192,
      ),
    ).toEqual({
      type: "assistant",
      message: {
        id: "message-1",
        model: "claude-opus",
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "Reasoning" },
          { type: "redacted_thinking" },
          { type: "text", text },
        ],
      },
    });
  });

  test("preserves escaped and chunk-split Unicode, duplicate keys, numbers, and JSON-owned properties", () => {
    const reader = createClaudeTranscriptJsonReader();
    const json =
      '{"type":"user","uuid":"old","uuid":"new","message":{"content":"\\uD83D\\uDE00\\n\\t\\\"é\\\\\\uD800","id":"x"},"toolUseResult":{"value":-1.25e+3,"ok":true,"none":null,"__proto__":{"owned":true}}}';
    for (const character of json) reader.write(character);
    const value = reader.finish()!;
    expect(value.uuid).toBe("new");
    expect(value.message).toMatchObject({ content: '😀\n\t"é\\\uD800' });
    expect(value.toolUseResult).toMatchObject({ value: -1250, ok: true, none: null });
    expect(Object.keys(value.toolUseResult!)).toContain("__proto__");
    expect(Object.getPrototypeOf(value.toolUseResult)).toBe(Object.prototype);
  });

  test.each([
    '{"type":"user","message":}',
    '{"type":"user",}',
    '{"type":"user"} trailing',
    '{"type":"user","message":"bad\\q"}',
    '{"type":"user","message":"bad\nline"}',
    "\u00a0",
    "\ufeff",
    "\f",
  ])("rejects a malformed complete record: %s", (json) => {
    const reader = createClaudeTranscriptJsonReader();
    expect(() => {
      reader.write(json);
      reader.finish();
    }).toThrow(ClaudeTranscriptJsonError);
  });

  test("distinguishes incomplete trailing writes from empty or invalid root records", () => {
    for (const json of [
      '{"type":"user"',
      '{"type":"user","message":"pending',
      '{"type":"user","value":',
    ]) {
      const reader = createClaudeTranscriptJsonReader();
      reader.write(json);
      try {
        reader.finish();
        throw new Error("Expected an incomplete record error");
      } catch (cause) {
        expect(cause).toBeInstanceOf(ClaudeTranscriptJsonError);
        if (!(cause instanceof ClaudeTranscriptJsonError)) throw cause;
        expect(cause.reason).toBe("incomplete");
      }
    }
    expect(() => readRecord([])).toThrow(ClaudeTranscriptJsonError);
    expect(() => readRecord("text")).toThrow(ClaudeTranscriptJsonError);
    const empty = createClaudeTranscriptJsonReader();
    empty.write(" \t\r");
    expect(empty.finish()).toBeNull();
  });

  test("rejects excessive nesting even inside a discarded field", () => {
    const reader = createClaudeTranscriptJsonReader();
    expect(() => {
      reader.write(`{"type":"user","unused":${"[".repeat(300)}0${"]".repeat(300)}}`);
      reader.finish();
    }).toThrow(ClaudeTranscriptJsonError);
  });

  test("checks final duplicate values for fast-record depth and physical nesting for oversized records", () => {
    const deep = `${"[".repeat(300)}0${"]".repeat(300)}`;
    const small = createClaudeTranscriptJsonReader();
    small.write(`{"type":"user","unused":${deep},"unused":0}`);
    expect(small.finish()).toEqual({ type: "user" });
    const large = createClaudeTranscriptJsonReader();
    expect(() => {
      large.write(`{"type":"user","snapshots":"${"A".repeat(3 * 1024 * 1024)}",`);
      large.write(`"unused":${deep},"unused":0}`);
      large.finish();
    }).toThrow(ClaudeTranscriptJsonError);
  });

  test("keeps complete tool input after a large discarded field crosses source chunks", () => {
    const input = { file_path: "/repo/full.ts", content: "line 😀\n".repeat(20_000) };
    expect(
      readRecord(
        {
          type: "assistant",
          uuid: "write-1",
          snapshots: "A".repeat(3 * 1024 * 1024),
          message: {
            content: [{ type: "tool_use", id: "call-1", name: "Write", input }],
          },
          parentUuid: "user-1",
        },
        65537,
      ),
    ).toEqual({
      type: "assistant",
      uuid: "write-1",
      message: { content: [{ type: "tool_use", id: "call-1", name: "Write", input }] },
      parentUuid: "user-1",
    });
  });

  test.each([false, true])("retains file content when its create type comes last: %s", (large) => {
    const content = "written line\n".repeat(10_000);
    const record: ClaudeProtocolObject = {
      type: "user",
      toolUseResult: { structuredContent: { content, type: "create" } },
    };
    if (large) record.snapshots = "A".repeat(3 * 1024 * 1024);
    const result = readRecord(record, 65537);
    expect(result?.toolUseResult).toEqual({ structuredContent: { content, type: "create" } });
  });

  test.each([false, true])("caps tool-result text when its type comes last: %s", (large) => {
    const text = "result line\n".repeat(10_000);
    const record: ClaudeProtocolObject = {
      type: "user",
      message: { content: [{ text, type: "tool_result", tool_use_id: "call-1" }] },
    };
    if (large) record.snapshots = "A".repeat(3 * 1024 * 1024);
    const result = readRecord(record, 65537);
    const message = z
      .object({ content: z.array(z.object({ text: z.string() })) })
      .parse(result?.message);
    expect(Buffer.byteLength(message.content[0]!.text)).toBeLessThanOrEqual(64 * 1024);
    expect(message.content[0]!.text).toContain("Claude tool output truncated");
  });

  test.each([
    [false, "text"],
    [true, "text"],
    [false, "tool_result"],
    [true, "tool_result"],
  ] as const)(
    "uses the final duplicate block type for text retention: large=%s, type=%s",
    (large, type) => {
      const text = "result line 😀\n".repeat(10_000);
      const initialType = type === "text" ? "tool_result" : "text";
      const reader = createClaudeTranscriptJsonReader();
      reader.write('{"type":"assistant","message":{"content":[{');
      reader.write(`"type":${JSON.stringify(initialType)},"text":${JSON.stringify(text)},`);
      reader.write(`"type":${JSON.stringify(type)}}]}`);
      if (large) reader.write(`,"snapshots":"${"A".repeat(3 * 1024 * 1024)}"`);
      reader.write("}");
      const result = reader.finish();
      const message = z
        .object({ content: z.array(z.object({ type: z.string(), text: z.string() })) })
        .parse(result?.message);
      const block = message.content[0]!;
      expect(block.type).toBe(type);
      if (type === "text") {
        expect(block.text).toBe(text);
      } else {
        expect(Buffer.byteLength(block.text)).toBeLessThanOrEqual(64 * 1024);
        expect(block.text).toEndWith(
          `[Claude tool output truncated; original size: ${Buffer.byteLength(text)} UTF-8 bytes]`,
        );
        expect(block.text).not.toContain("�");
      }
    },
  );

  test.each<[string, ClaudeTranscriptJsonError["reason"]]>([
    ['{"type":"user","message":"bad\\q"}', "malformed"],
    ['{"type":"user","message":"bad\\u00ZZ"}', "malformed"],
    ['{"type":"user","message":truth', "malformed"],
    ['{"type":"user","message":"bad\\q\\', "malformed"],
    ['{"type":"user","message":t.tru', "malformed"],
    ['{"type":"user","message":"pending\\', "incomplete"],
    ['{"type":"user","message":"pending\\u00', "incomplete"],
    ['{"type":"user","message":tru', "incomplete"],
  ])("classifies a tokenizer error at end of input: %s", (json, reason) => {
    const reader = createClaudeTranscriptJsonReader();
    try {
      reader.write(json);
      reader.finish();
      throw new Error("Expected a transcript JSON error");
    } catch (cause) {
      if (!(cause instanceof ClaudeTranscriptJsonError)) throw cause;
      expect(cause.reason).toBe(reason);
    }
  });

  test("reads session scope without collecting conversation or tool payloads", () => {
    const reader = createClaudeTranscriptJsonReader({ metadataOnly: true });
    reader.write('{"type":"user","sessionId":"session-1","cwd":"/repo","message":{"content":"');
    const chunk = "x".repeat(8192);
    for (let index = 0; index < 4096; index++) reader.write(chunk);
    reader.write('"},"relocated":{"relocatedCwd":"/moved","unused":"discarded"}}');
    expect(reader.finish()).toEqual({
      type: "user",
      sessionId: "session-1",
      cwd: "/repo",
      relocated: { relocatedCwd: "/moved" },
    });
  });

  test("reads child completion and graph metadata without tool inputs, outputs, or media", () => {
    const reader = createClaudeTranscriptJsonReader({ summaryOnly: true });
    reader.write(
      JSON.stringify({
        type: "assistant",
        subtype: "compact_boundary",
        uuid: "assistant-1",
        parentUuid: "user-1",
        sessionId: "session-1",
        supersedes: ["assistant-0"],
        retracted_message_uuids: ["retracted-1"],
        isSidechain: true,
        teamName: "team-1",
        agentId: "agent-1",
        sourceToolAssistantUUID: "source-1",
        parent_tool_use_id: "parent-call-1",
        parent_agent_id: "parent-agent-1",
        attachment: { type: "fork_briefing", prompt: "discarded" },
        compactMetadata: {
          preservedMessages: {
            anchorUuid: "anchor-1",
            uuids: ["preserved-1"],
            unused: "discarded",
          },
          preservedSegment: { anchorUuid: "anchor-2", headUuid: "head-1", tailUuid: "tail-1" },
          unused: "discarded",
        },
        message: {
          id: "response-1",
          role: "assistant",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "Final report" },
            {
              type: "tool_use",
              id: "call-1",
              name: "Write",
              input: { content: "i".repeat(500_000) },
            },
            { type: "tool_result", tool_use_id: "call-1", content: "o".repeat(500_000) },
            { type: "image", source: { data: "b".repeat(500_000) } },
          ],
        },
        toolUseResult: { content: "r".repeat(500_000) },
      }),
    );
    expect(reader.finish()).toEqual({
      type: "assistant",
      subtype: "compact_boundary",
      uuid: "assistant-1",
      parentUuid: "user-1",
      sessionId: "session-1",
      supersedes: ["assistant-0"],
      retracted_message_uuids: ["retracted-1"],
      isSidechain: true,
      teamName: "team-1",
      agentId: "agent-1",
      sourceToolAssistantUUID: "source-1",
      parent_tool_use_id: "parent-call-1",
      parent_agent_id: "parent-agent-1",
      attachment: { type: "fork_briefing" },
      compactMetadata: {
        preservedMessages: { anchorUuid: "anchor-1", uuids: ["preserved-1"] },
        preservedSegment: { anchorUuid: "anchor-2", headUuid: "head-1", tailUuid: "tail-1" },
      },
      message: {
        id: "response-1",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "x" },
          { type: "tool_use", id: "call-1" },
          { type: "tool_result", tool_use_id: "call-1" },
          { type: "image" },
        ],
      },
    });
  });

  test.each([false, true])(
    "summarizes chunked whitespace text with a late non-space: %s",
    (hasText) => {
      const reader = createClaudeTranscriptJsonReader({ summaryOnly: true });
      reader.write('{"type":"assistant","message":{"content":[{"type":"text","text":"');
      const chunk = " \u00a0\u2009\u2028\ufeff".repeat(1638);
      for (let index = 0; index < 1024; index++) reader.write(chunk);
      if (hasText) {
        reader.write("\\u00");
        reader.write("78");
      }
      reader.write('"}],"stop_reason":null},"parent_tool_use_id":"parent-call-1"}');
      expect(reader.finish()).toEqual({
        type: "assistant",
        message: { content: [{ type: "text", text: hasText ? "x" : "" }], stop_reason: null },
        parent_tool_use_id: "parent-call-1",
      });
    },
  );

  test("discards Read image bytes and limits Read text while preserving structured edits", () => {
    const content = "read text\n".repeat(10_000);
    const result = readRecord(
      {
        type: "user",
        uuid: "read-result",
        toolUseResult: {
          file: { filePath: "/repo/image.png", base64: "b".repeat(2_000_000), content },
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "b".repeat(2_000_000) },
            },
          ],
          structuredContent: {
            type: "update",
            file: "/repo/file.ts",
            originalFile: "old",
            content,
          },
        },
      },
      8192,
    )!;
    const toolUseResult = z
      .object({
        file: z.object({ filePath: z.string(), content: z.string() }).strict(),
        content: z.array(
          z.object({ source: z.object({ type: z.string(), media_type: z.string() }).strict() }),
        ),
        structuredContent: z.object({ content: z.string() }),
      })
      .parse(result.toolUseResult);
    expect(Buffer.byteLength(toolUseResult.file.content)).toBeLessThanOrEqual(64 * 1024);
    expect(toolUseResult.file.content).toContain("Claude tool output truncated");
    expect(toolUseResult.structuredContent.content).toBe(content);
  });

  test("retains native relocation records in history and scope-only reads", () => {
    const record = { type: "relocated", relocatedCwd: "/moved" };
    expect(readRecord(record)).toEqual(record);
    const reader = createClaudeTranscriptJsonReader({ metadataOnly: true });
    reader.write(JSON.stringify(record));
    expect(reader.finish()).toEqual(record);
  });

  test("keeps queued prompt text and delivery metadata without attachment bytes", () => {
    const text = "Queued prompt. ".repeat(6000);
    expect(
      readRecord(
        {
          type: "attachment",
          uuid: "queued-1",
          attachment: {
            type: "queued_command",
            source_uuid: "source-1",
            delivery_id: "delivery-1",
            isMeta: false,
            forwardedIntent: "user",
            commandMode: "prompt",
            origin: { kind: "user" },
            runId: "run-1",
            prompt: [
              { type: "text", text },
              { type: "image", source: { media_type: "image/png", data: "binary" } },
            ],
          },
        },
        8192,
      ),
    ).toEqual({
      type: "attachment",
      uuid: "queued-1",
      attachment: {
        type: "queued_command",
        source_uuid: "source-1",
        delivery_id: "delivery-1",
        isMeta: false,
        forwardedIntent: "user",
        commandMode: "prompt",
        origin: { kind: "user" },
        runId: "run-1",
        prompt: [
          { type: "text", text },
          { type: "image", source: { media_type: "image/png" } },
        ],
      },
    });
    expect(
      readRecord({
        type: "queue-operation",
        operation: "remove",
        reason: "absorbed_mid_turn",
        deliveryId: "delivery-1",
        commandUuid: "queued-1",
        content: "unused",
      }),
    ).toEqual({
      type: "queue-operation",
      operation: "remove",
      reason: "absorbed_mid_turn",
      deliveryId: "delivery-1",
      commandUuid: "queued-1",
    });
  });
});
