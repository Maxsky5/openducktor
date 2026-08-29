import { describe, expect, test } from "bun:test";
import {
  opencodeAgentListPayloadSchema,
  opencodeMessageInfoPayloadSchema,
  opencodePartPayloadSchema,
  opencodeProviderCatalogPayloadSchema,
  opencodeSessionDetailPayloadSchema,
  opencodeSessionMessagesPayloadSchema,
  parseOpencodeSessionListPayload,
} from "./opencode-ingress";
import { normalizeOpencodeGlobalEventPayload } from "./opencode-agent-session-projection";
import { parseOpencodeGlobalEventPayload } from "./opencode-global-event-ingress";
import {
  createOpencodeMessageInfoFixture,
  createOpencodePartFixture,
} from "./opencode-protocol-test-fixtures";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";

describe("OpenCode ingress schemas", () => {
  test("reduces explicitly ignored global events to their routing decision", () => {
    expect(
      parseOpencodeGlobalEventPayload({
        id: "event-1",
        type: "server.connected",
        properties: {},
      }),
    ).toEqual({ kind: "ignored", id: "event-1", type: "server.connected" });

    expect(() =>
      parseOpencodeGlobalEventPayload({
        id: "event-2",
        type: "future.additive.event",
        properties: { addedByRuntime: true },
      }),
    ).toThrow("Invalid OpenCode global event payload (future.additive.event)");

    expect(() =>
      normalizeOpencodeGlobalEventPayload({
        id: "event-3",
        type: "sync",
        syncEvent: {
          aggregateID: "session-1",
          data: {},
          id: "sync-event-1",
          seq: 1,
          type: "future.additive.event.1",
        },
      }),
    ).toThrow("has no normalization decision");
  });

  test("preserves producer-declared unknown provider and agent options", () => {
    const loadedAt = new Date();
    const providerCatalog = opencodeProviderCatalogPayloadSchema.parse({
      providers: [
        {
          env: [],
          id: "openai",
          models: {
            "gpt-5": {
              api: { id: "gpt-5", npm: "@ai-sdk/openai", url: "https://api.openai.com" },
              capabilities: {
                attachment: true,
                input: { audio: false, image: true, pdf: true, text: true, video: false },
                interleaved: false,
                output: { audio: false, image: false, pdf: false, text: true, video: false },
                reasoning: true,
                temperature: true,
                toolcall: true,
              },
              cost: { cache: { read: 0, write: 0 }, input: 0, output: 0 },
              headers: {},
              id: "gpt-5",
              limit: { context: 128_000, output: 16_384 },
              name: "GPT-5",
              options: { loadedAt },
              providerID: "openai",
              release_date: "2026-01-01",
              status: "active",
            },
          },
          name: "OpenAI",
          options: {},
          source: "config",
        },
      ],
      default: {},
    });
    expect(providerCatalog.providers[0]?.models["gpt-5"]?.options.loadedAt).toBe(loadedAt);

    const agents = opencodeAgentListPayloadSchema.parse([
      { name: "build", mode: "primary", options: { loadedAt }, permission: [] },
    ]);
    expect(agents[0]?.options.loadedAt).toBe(loadedAt);
  });

  test("treats null OpenCode agent optionals as absent", () => {
    expect(
      opencodeAgentListPayloadSchema.parse([
        {
          color: null,
          description: null,
          hidden: null,
          mode: "subagent",
          model: null,
          name: "explore",
          native: null,
          options: {},
          permission: [],
          prompt: null,
          steps: null,
          temperature: null,
          topP: null,
          variant: null,
        },
      ]),
    ).toEqual([
      {
        mode: "subagent",
        name: "explore",
        options: {},
        permission: [],
      },
    ]);
  });

  test("preserves producer-declared unknown history and tool-part data", () => {
    const receivedAt = new Date();
    const part = createOpencodePartFixture({
      id: "tool-1",
      sessionID: "session-1",
      messageID: "assistant-1",
      type: "tool",
      callID: "call-1",
      tool: "todowrite",
      state: {
        status: "running",
        input: {},
        metadata: { receivedAt },
      },
    });
    const messageInfo = createOpencodeMessageInfoFixture({
      id: "assistant-1",
      role: "assistant",
      structured: { receivedAt },
    });

    expect(opencodePartPayloadSchema.parse(part).state.metadata).toEqual({ receivedAt });
    expect(opencodeSessionMessagesPayloadSchema.parse([{ info: messageInfo, parts: [] }])).toEqual([
      { info: messageInfo, parts: [] },
    ]);
  });

  test("accepts every string allowed by the OpenCode Session parentID type", () => {
    expect(
      opencodeSessionDetailPayloadSchema.parse({
        directory: "/repo",
        id: "session-1",
        parentID: "",
        projectID: "project-1",
        slug: "session-1",
        time: { created: 1, updated: 1 },
        title: "Session",
        version: "1.18.18",
      }).parentID,
    ).toBe("");
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

  test("rejects malformed sessions before runtime snapshot mapping", () => {
    expect(() =>
      parseOpencodeSessionListPayload([
        {
          id: "session-1",
          projectID: "project-1",
          directory: "/repo",
          slug: "session-1",
          time: { created: 1, updated: 1 },
          version: "1.18.18",
        },
      ]),
    ).toThrow("Invalid OpenCode session list payload: 0.title");
  });
});
