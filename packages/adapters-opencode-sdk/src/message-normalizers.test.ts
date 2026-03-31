import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";
import {
  extractMessageTotalTokens,
  normalizeUserMessageDisplayParts,
  readMessageModelSelection,
  readTextFromMessageInfo,
  readTextFromParts,
  readVisibleUserTextFromDisplayParts,
  sanitizeAssistantMessage,
} from "./message-normalizers";

describe("message-normalizers", () => {
  test("readTextFromParts joins only text parts", () => {
    const parts: Part[] = [
      {
        id: "text-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "First line",
      } as Part,
      {
        id: "reason-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "reasoning",
        text: "Should be ignored",
      } as Part,
      {
        id: "text-2",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "Second line",
      } as Part,
    ];

    expect(readTextFromParts(parts)).toBe("First line\nSecond line");
  });

  test("readTextFromMessageInfo resolves nested message text", () => {
    expect(readTextFromMessageInfo({ message: { text: "  From nested info  " } })).toBe(
      "From nested info",
    );
    expect(readTextFromMessageInfo(null)).toBe("");
  });

  test("normalizes user display parts by filtering synthetic text and preserving file refs", () => {
    const parts: Part[] = [
      {
        id: "text-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "check @src/main.ts please",
      } as Part,
      {
        id: "text-2",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: 'Called the Read tool with the following input: {"filePath":"src/main.ts"}',
        synthetic: true,
      } as Part,
      {
        id: "file-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "text/plain",
        filename: "main.ts",
        url: "file:///repo/src/main.ts",
        source: {
          type: "file",
          path: "src/main.ts",
          text: {
            value: "@src/main.ts",
            start: 6,
            end: 19,
          },
        },
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "text",
        text: "check @src/main.ts please",
      },
      {
        kind: "file_reference",
        file: {
          id: "file-1",
          path: "src/main.ts",
          name: "main.ts",
          kind: "code",
        },
        sourceText: {
          value: "@src/main.ts",
          start: 6,
          end: 19,
        },
      },
    ]);
  });

  test("reads visible user text from display parts without synthetic runtime text", () => {
    expect(
      readVisibleUserTextFromDisplayParts([
        { kind: "text", text: "check @src/main.ts please" },
        {
          kind: "file_reference",
          file: {
            id: "file-1",
            path: "src/main.ts",
            name: "main.ts",
            kind: "code",
          },
          sourceText: {
            value: "@src/main.ts",
            start: 6,
            end: 19,
          },
        },
      ]),
    ).toBe("check @src/main.ts please");

    expect(
      readVisibleUserTextFromDisplayParts([
        {
          kind: "file_reference",
          file: {
            id: "file-2",
            path: "src/only.ts",
            name: "only.ts",
            kind: "code",
          },
          sourceText: {
            value: "@src/only.ts",
            start: 0,
            end: 12,
          },
        },
      ]),
    ).toBe("@src/only.ts");
  });

  test("sanitizeAssistantMessage trims surrounding whitespace", () => {
    expect(sanitizeAssistantMessage("  done  ")).toBe("done");
  });

  test("readMessageModelSelection supports assistant and user message shapes", () => {
    expect(
      readMessageModelSelection({
        providerID: "openai",
        modelID: "gpt-5",
        agent: "Hephaestus",
        variant: "high",
      }),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });

    expect(
      readMessageModelSelection({
        model: {
          providerID: "anthropic",
          modelID: "claude-3-7-sonnet",
        },
        agent: "Ares",
        variant: "max",
      }),
    ).toEqual({
      providerId: "anthropic",
      modelId: "claude-3-7-sonnet",
      profileId: "Ares",
      variant: "max",
    });
  });

  test("extractMessageTotalTokens prefers info token breakdown", () => {
    const info = {
      tokens: {
        input: 300,
        output: 120,
        reasoning: 30,
        cache: {
          read: 20,
          write: 10,
        },
      },
    };

    const total = extractMessageTotalTokens(info, []);
    expect(total).toBe(480);
  });

  test("extractMessageTotalTokens falls back to max part token total", () => {
    const parts: Array<Part | Record<string, unknown>> = [
      {
        id: "part-1",
        tokens: 42,
      },
      {
        id: "part-2",
        tokens: {
          input: 10,
          output: 60,
        },
      },
    ];

    const total = extractMessageTotalTokens({}, parts);
    expect(total).toBe(70);
  });
});
