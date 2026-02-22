import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChatMessageCard } from "./agent-chat-message-card";

describe("AgentChatMessageCard tool duration", () => {
  test("prefers observed wall-clock timing over part timing", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-1",
          role: "tool",
          content: "Tool openducktor_odt_set_spec completed",
          timestamp: "2026-02-20T19:01:00.000Z",
          meta: {
            kind: "tool",
            partId: "part-1",
            callId: "call-1",
            tool: "openducktor_odt_set_spec",
            status: "completed",
            input: { taskId: "fairnest-abc", markdown: "# Spec" },
            output: "ok",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
            observedStartedAtMs: Date.parse("2026-02-20T19:00:00.000Z"),
            observedEndedAtMs: Date.parse("2026-02-20T19:01:00.000Z"),
          },
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("1m");
    expect(html).not.toContain("1.5s");
  });

  test("falls back to part timing when observed timing is absent", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-2",
          role: "tool",
          content: "Tool openducktor_odt_set_spec completed",
          timestamp: "2026-02-20T19:00:02.500Z",
          meta: {
            kind: "tool",
            partId: "part-2",
            callId: "call-2",
            tool: "openducktor_odt_set_spec",
            status: "completed",
            input: { taskId: "fairnest-def", markdown: "# Spec" },
            output: "ok",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
          },
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("1.5s");
  });

  test("renders expandable details for regular read_task tool rows", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-3",
          role: "tool",
          content: "Tool read_task completed",
          timestamp: "2026-02-22T10:20:30.000Z",
          meta: {
            kind: "tool",
            partId: "part-3",
            callId: "call-3",
            tool: "read_task",
            status: "completed",
            input: { taskId: "fairnest-97f" },
            output: '{"task":{"id":"fairnest-97f","title":"Add Facebook login"}}',
          },
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Input");
    expect(html).toContain("Output");
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("fairnest-97f");
  });

  test("renders workflow tool pending state with spinner", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-4",
          role: "tool",
          content: "Tool openducktor_odt_build_completed running",
          timestamp: "2026-02-22T10:21:00.000Z",
          meta: {
            kind: "tool",
            partId: "part-4",
            callId: "call-4",
            tool: "openducktor_odt_build_completed",
            status: "pending",
            input: { taskId: "fairnest-98a" },
            output: "",
          },
        },
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("animate-spin");
    expect(html).toContain("build_completed");
  });

  test("renders system prompt as expandable card", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "sys-1",
          role: "system",
          content: "System prompt:\n\nAlways validate tool inputs before execution.",
          timestamp: "2026-02-22T10:22:00.000Z",
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Show system prompt");
    expect(html).toContain("Always validate tool inputs");
  });

  test("renders assistant footer with agent and model labels", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "assistant-1",
          role: "assistant",
          content: "Implemented the requested changes.",
          timestamp: "2026-02-22T10:23:00.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            opencodeAgent: "planner-main",
            modelId: "gpt-5.3-codex",
          },
        },
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("planner-main");
    expect(html).toContain("gpt-5.3-codex");
  });
});
