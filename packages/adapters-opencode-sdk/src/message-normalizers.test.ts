import type { Part } from "@opencode-ai/sdk/v2/client";
import { describe, expect, test } from "./bun-test";
import {
  extractMessageTotalTokens,
  readTextFromMessageInfo,
  readTextFromParts,
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

  test("sanitizeAssistantMessage trims surrounding whitespace", () => {
    expect(sanitizeAssistantMessage("  done  ")).toBe("done");
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
