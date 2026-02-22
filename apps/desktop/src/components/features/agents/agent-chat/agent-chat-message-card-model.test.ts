import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  assistantRoleFromMessage,
  buildToolSummary,
  formatRawJsonLikeText,
  getAssistantFooterData,
  getToolDuration,
  questionToolDetails,
  roleLabel,
  stripToolPrefix,
} from "./agent-chat-message-card-model";

const createToolMeta = (
  overrides: Partial<Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>> = {},
): Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }> => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  status: "completed",
  ...overrides,
});

describe("agent-chat-message-card-model", () => {
  test("formats JSON-like output when valid JSON", () => {
    expect(formatRawJsonLikeText('{"a":1}')).toContain('"a": 1');
    expect(formatRawJsonLikeText("not-json")).toBe("not-json");
  });

  test("maps assistant role labels using metadata or session fallback", () => {
    const assistantMessage: AgentChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "Hello",
      timestamp: "2026-02-22T10:00:00.000Z",
      meta: {
        kind: "assistant",
        agentRole: "planner",
      },
    };

    expect(assistantRoleFromMessage(assistantMessage, "spec")).toBe("planner");
    expect(roleLabel("assistant", "build", assistantMessage)).toBe("Planner");

    const noMetaMessage: AgentChatMessage = {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      timestamp: assistantMessage.timestamp,
    };
    expect(assistantRoleFromMessage(noMetaMessage, "qa")).toBe("qa");
    expect(roleLabel("assistant", "qa", noMetaMessage)).toBe("QA");
  });

  test("builds todo summaries from structured todo output", () => {
    const summary = buildToolSummary(
      createToolMeta({
        tool: "todowrite",
        output: JSON.stringify({ todos: [{ id: "1" }, { id: "2" }] }),
      }),
      "",
    );

    expect(summary).toBe("2 todos");
  });

  test("builds search summaries from input patterns", () => {
    const summary = buildToolSummary(
      createToolMeta({
        tool: "grep",
        input: { pattern: "agent", path: "apps/desktop/src" },
      }),
      "",
    );

    expect(summary).toBe("agent in apps/desktop/src");
  });

  test("builds question details from output answers", () => {
    const details = questionToolDetails(
      createToolMeta({
        tool: "question",
        input: {
          questions: [{ question: "Choose role" }],
        },
        output: JSON.stringify({ answers: [["planner"]] }),
      }),
    );

    expect(details).toEqual([{ prompt: "Choose role", answers: ["planner"] }]);
  });

  test("computes duration using observed timing first then fallback timing", () => {
    const withObserved = getToolDuration(
      createToolMeta({
        observedStartedAtMs: 100,
        observedEndedAtMs: 260,
        startedAtMs: 100,
        endedAtMs: 150,
      }),
      "2026-02-22T10:00:00.000Z",
    );
    expect(withObserved).toBe(160);

    const withFallback = getToolDuration(
      createToolMeta({
        startedAtMs: 100,
        endedAtMs: 160,
      }),
      "2026-02-22T10:00:00.000Z",
    );
    expect(withFallback).toBe(60);
  });

  test("returns assistant footer labels from assistant metadata", () => {
    const message: AgentChatMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      timestamp: "2026-02-22T10:00:00.000Z",
      meta: {
        kind: "assistant",
        agentRole: "build",
        modelId: "gpt-5",
        opencodeAgent: "builder",
      },
    };

    const footer = getAssistantFooterData(message, {
      providerId: "openai",
      modelId: "gpt-4",
      opencodeAgent: "fallback",
    });

    expect(footer.infoParts).toEqual(["builder", "gpt-5"]);
  });

  test("strips tool prefix and status from tool content", () => {
    expect(stripToolPrefix("read_task", "Tool read_task completed: loaded")).toBe("loaded");
    expect(stripToolPrefix("bash", "queued: npm test")).toBe("npm test");
  });
});
