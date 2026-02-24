import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  assistantRoleFromMessage,
  buildToolSummary,
  formatRawJsonLikeText,
  getAssistantFooterData,
  getToolDuration,
  getToolLifecyclePhase,
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

  test("derives lifecycle phases from status, payload and errors", () => {
    expect(
      getToolLifecyclePhase(
        createToolMeta({
          status: "pending",
          input: {},
        }),
      ),
    ).toBe("queued");

    expect(
      getToolLifecyclePhase(
        createToolMeta({
          status: "pending",
          input: { taskId: "fairnest-123" },
        }),
      ),
    ).toBe("executing");

    expect(
      getToolLifecyclePhase(
        createToolMeta({
          status: "running",
        }),
      ),
    ).toBe("executing");

    expect(
      getToolLifecyclePhase(
        createToolMeta({
          status: "completed",
        }),
      ),
    ).toBe("completed");

    expect(
      getToolLifecyclePhase(
        createToolMeta({
          tool: "odt_set_plan",
          status: "completed",
          output: "MCP error -32602: Input validation error",
        }),
      ),
    ).toBe("failed");

    expect(
      getToolLifecyclePhase(
        createToolMeta({
          status: "error",
          error: "Tool call cancelled by user",
        }),
      ),
    ).toBe("cancelled");
  });

  test("computes duration from input-ready timestamp and ignores queue time", () => {
    const withInputReady = getToolDuration(
      createToolMeta({
        status: "completed",
        inputReadyAtMs: 130,
        observedStartedAtMs: 100,
        observedEndedAtMs: 260,
        startedAtMs: 100,
        endedAtMs: 150,
      }),
      "2026-02-22T10:00:00.000Z",
    );
    expect(withInputReady).toBe(130);

    const queued = getToolDuration(
      createToolMeta({
        status: "pending",
        input: {},
      }),
      "2026-02-22T10:00:00.000Z",
    );
    expect(queued).toBeNull();

    const executing = getToolDuration(
      createToolMeta({
        status: "pending",
        input: { taskId: "fairnest-111" },
        inputReadyAtMs: 100,
        observedEndedAtMs: 260,
      }),
      "2026-02-22T10:00:00.000Z",
    );
    expect(executing).toBeNull();

    const withFallback = getToolDuration(
      createToolMeta({
        status: "completed",
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
    expect(stripToolPrefix("bash", "cancelled: interrupted by user")).toBe("interrupted by user");
  });
});
