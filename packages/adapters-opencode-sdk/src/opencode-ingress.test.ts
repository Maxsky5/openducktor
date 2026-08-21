import { describe, expect, test } from "bun:test";
import {
  opencodeAgentListPayloadSchema,
  opencodeMessageInfoPayloadSchema,
  opencodePartPayloadSchema,
  opencodeProviderCatalogPayloadSchema,
  opencodeSessionMessagesPayloadSchema,
  parseOpencodeGlobalEventPayload,
} from "./opencode-ingress";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";

describe("OpenCode ingress schemas", () => {
  test("rejects non-JSON nested data in non-sync global events", () => {
    expect(() =>
      parseOpencodeGlobalEventPayload({
        type: "server.connected",
        properties: { transport: { connectedAt: new Date() } },
      }),
    ).toThrow("Invalid OpenCode global event payload");
  });

  test("rejects non-JSON nested provider and agent catalog data", () => {
    expect(
      opencodeProviderCatalogPayloadSchema.safeParse({
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            models: {
              "gpt-5": {
                name: "GPT-5",
                options: { loadedAt: new Date() },
              },
            },
          },
        ],
        default: {},
      }).success,
    ).toBe(false);

    expect(
      opencodeAgentListPayloadSchema.safeParse([
        { name: "build", mode: "primary", options: { loadedAt: new Date() } },
      ]).success,
    ).toBe(false);
  });

  test("rejects non-JSON nested history and tool-part data", () => {
    const part = {
      id: "tool-1",
      sessionID: "session-1",
      messageID: "assistant-1",
      type: "tool",
      tool: "todowrite",
      state: {
        input: {},
        metadata: { receivedAt: new Date() },
      },
    };

    expect(opencodePartPayloadSchema.safeParse(part).success).toBe(false);
    expect(
      opencodeSessionMessagesPayloadSchema.safeParse([
        {
          info: {
            id: "assistant-1",
            role: "assistant",
            time: { created: 1 },
            structured: { receivedAt: new Date() },
          },
          parts: [],
        },
      ]).success,
    ).toBe(false);
  });

  test("rejects malformed part variants before mapping", () => {
    const malformedParts = [
      {
        id: "text-1",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "text",
      },
      {
        id: "tool-1",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        state: {},
      },
      {
        id: "tool-2",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        tool: "read",
        state: {},
      },
      {
        id: "tool-3",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-3",
        tool: "read",
      },
      {
        id: "tool-4",
        sessionID: "session-1",
        type: "tool",
        callID: "call-4",
        tool: "read",
        state: {},
      },
    ];

    for (const part of malformedParts) {
      expect(opencodePartPayloadSchema.safeParse(part).success).toBe(false);
      expect(() => mapPartToAgentStreamPart(part)).toThrow();
    }
  });

  test("rejects malformed user and assistant messages at ingress", () => {
    const malformedMessages = [
      { role: "user", time: { created: 1 } },
      { id: "user-1", role: "user", time: {} },
      { id: "assistant-1", role: "assistant" },
    ];

    for (const message of malformedMessages) {
      expect(opencodeMessageInfoPayloadSchema.safeParse(message).success).toBe(false);
      expect(
        opencodeSessionMessagesPayloadSchema.safeParse([{ info: message, parts: [] }]).success,
      ).toBe(false);
    }
  });
});
