import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildMessage } from "./agent-chat-test-fixtures";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import type { AgentChatVirtualRow } from "./agent-chat-thread-virtualization";

const baseProps = {
  sessionAgentColors: {},
  sessionRole: "spec" as const,
  sessionSelectedModel: null,
  sessionWorkingDirectory: "/repo",
};

describe("AgentChatThreadRow", () => {
  test("renders turn duration rows", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...baseProps,
        row: { kind: "turn_duration", key: "duration-1", durationMs: 1200 },
      }),
    );

    expect(html).toContain("1.2s");
  });

  test("renders message rows", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...baseProps,
        row: {
          kind: "message",
          key: "message-1",
          message: buildMessage("user", "Ship it"),
        },
      }),
    );

    expect(html).toContain("Ship it");
  });

  test("throws for unknown row kinds", () => {
    const render = () =>
      renderToStaticMarkup(
        createElement(AgentChatThreadRow, {
          ...baseProps,
          row: { kind: "unexpected", key: "broken" } as unknown as AgentChatVirtualRow,
        }),
      );

    expect(render).toThrow("Unhandled agent chat row");
  });
});
