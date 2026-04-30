import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  coerceSessionSelectionToCatalog,
  mergeTodoListPreservingOrder,
  parseTodosFromToolInput,
  parseTodosFromToolOutput,
  pickDefaultSessionSelectionForCatalog,
  resolveToolMessageId,
  shouldReattachListenerForAttachedSession,
} from "./utils";

const createSession = (messages: AgentChatMessage[]) => ({
  externalSessionId: "session-1",
  messages,
});

const catalogFixture: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["high", "low"],
    },
    {
      id: "anthropic/claude-sonnet-4",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet-4",
      modelName: "Claude Sonnet 4",
      variants: [],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [{ name: "xhigh", mode: "all" }],
};

describe("agent-orchestrator-utils", () => {
  test("picks the default session selection for a catalog", () => {
    const selection = pickDefaultSessionSelectionForCatalog(catalogFixture);
    expect(selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
  });

  test("coerces a session selection to the current catalog", () => {
    const selection = coerceSessionSelectionToCatalog(catalogFixture, {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "missing",
      profileId: "xhigh",
    });

    expect(selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "xhigh",
    });
  });

  test("parses todos from tool input and output payloads", () => {
    const fromInput = parseTodosFromToolInput({
      todos: [
        "first",
        {
          id: "todo-2",
          content: "second",
          status: "done",
          priority: "high",
        },
      ],
    });
    const fromOutput = parseTodosFromToolOutput(
      JSON.stringify({
        todos: [
          {
            id: "todo-3",
            title: "third",
            completed: false,
          },
        ],
      }),
    );

    expect(fromInput).toEqual([
      {
        id: "todo:0",
        content: "first",
        status: "pending",
        priority: "medium",
      },
      {
        id: "todo-2",
        content: "second",
        status: "completed",
        priority: "high",
      },
    ]);
    expect(fromOutput).toEqual([
      {
        id: "todo-3",
        content: "third",
        status: "pending",
        priority: "medium",
      },
    ]);
  });

  test("preserves previous todo order when merging", () => {
    const merged = mergeTodoListPreservingOrder(
      [
        { id: "a", content: "A", status: "pending", priority: "medium" },
        { id: "b", content: "B", status: "pending", priority: "medium" },
      ],
      [
        { id: "b", content: "B2", status: "in_progress", priority: "high" },
        { id: "c", content: "C", status: "pending", priority: "low" },
        { id: "a", content: "A2", status: "completed", priority: "medium" },
      ],
    );

    expect(merged.map((todo) => todo.id)).toEqual(["a", "b", "c"]);
    expect(merged[0]?.content).toBe("A2");
    expect(merged[1]?.status).toBe("in_progress");
  });

  test("resolves tool message ids by callId and fallback running rows", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "tool:m1:old",
        role: "tool",
        content: "running",
        timestamp: "2026-02-22T08:00:00.000Z",
        meta: {
          kind: "tool",
          partId: "old",
          callId: "call-1",
          tool: "todowrite",
          status: "running",
        },
      },
    ];

    const byCallId = resolveToolMessageId(
      createSession(messages),
      {
        messageId: "m2",
        callId: "call-1",
        tool: "todowrite",
        status: "completed",
      },
      "tool:m2:new",
    );
    const byMessageFallback = resolveToolMessageId(
      createSession(messages),
      {
        messageId: "m1",
        callId: "",
        tool: "todowrite",
        status: "completed",
      },
      "tool:m1:new",
    );

    expect(byCallId).toBe("tool:m1:old");
    expect(byMessageFallback).toBe("tool:m1:old");
  });

  test("reattaches listener only for non-error attached sessions", () => {
    expect(shouldReattachListenerForAttachedSession("running", false)).toBe(true);
    expect(shouldReattachListenerForAttachedSession("idle", true)).toBe(false);
    expect(shouldReattachListenerForAttachedSession("error", false)).toBe(false);
  });
});
