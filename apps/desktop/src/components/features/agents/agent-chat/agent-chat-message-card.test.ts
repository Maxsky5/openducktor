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
});
