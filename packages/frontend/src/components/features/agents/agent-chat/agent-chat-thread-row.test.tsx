import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildMessage } from "./agent-chat-test-fixtures";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";

const baseProps = {
  isStreamingAssistantMessage: false,
  sessionAgentColors: {},
  sessionIdentity: {
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    taskId: "task-1",
    role: "spec" as const,
  },
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

  test("renders fork boundary rows with the transcript separator treatment", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...baseProps,
        row: {
          kind: "fork_boundary",
          key: "fork-1",
          label: "Session forked here",
          parentExternalSessionId: "parent-thread",
        },
      }),
    );

    expect(html).toContain("Session forked here");
    expect(html.match(/aria-hidden/g)).toHaveLength(2);
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
          row: {
            kind: "unexpected",
            key: "broken",
          } as unknown as AgentChatTranscriptRow,
        }),
      );

    expect(render).toThrow("Unhandled agent chat row");
  });
});
