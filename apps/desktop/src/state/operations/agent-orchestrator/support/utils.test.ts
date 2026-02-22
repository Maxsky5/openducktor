import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  isDuplicateAssistantMessage,
  mergeTodoListPreservingOrder,
  normalizeSelectionForCatalog,
  parseTodosFromToolInput,
  parseTodosFromToolOutput,
  pickDefaultModel,
  resolveToolMessageId,
  shouldReattachListenerForAttachedSession,
} from "./utils";

const catalogFixture: AgentModelCatalog = {
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
  agents: [{ name: "xhigh", mode: "all" }],
};

describe("agent-orchestrator-utils", () => {
  test("picks provider default model selection", () => {
    const selection = pickDefaultModel(catalogFixture);
    expect(selection).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
  });

  test("normalizes model selection to catalog variants and agents", () => {
    const selection = normalizeSelectionForCatalog(catalogFixture, {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "missing",
      opencodeAgent: "xhigh",
    });

    expect(selection).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "xhigh",
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
      messages,
      {
        messageId: "m2",
        callId: "call-1",
        tool: "todowrite",
        status: "completed",
      },
      "tool:m2:new",
    );
    const byMessageFallback = resolveToolMessageId(
      messages,
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

  test("detects duplicate assistant message within timestamp tolerance", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Done",
        timestamp: "2026-02-22T08:00:00.000Z",
      },
    ];

    expect(isDuplicateAssistantMessage(messages, "Done", "2026-02-22T08:00:01.500Z")).toBe(true);
    expect(isDuplicateAssistantMessage(messages, "Different", "2026-02-22T08:00:01.500Z")).toBe(
      false,
    );
  });

  test("reattaches listener only for non-error attached sessions", () => {
    expect(shouldReattachListenerForAttachedSession("running", false)).toBe(true);
    expect(shouldReattachListenerForAttachedSession("idle", true)).toBe(false);
    expect(shouldReattachListenerForAttachedSession("error", false)).toBe(false);
  });
});
