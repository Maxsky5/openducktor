import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildMessage, presentRegularToolCall } from "./agent-chat-test-fixtures";
import { AgentChatThreadRow } from "./agent-chat-thread-row";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";

const createBaseProps = () => ({
  isStreamingAssistantMessage: false,
  sessionIdentity: {
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    taskId: "task-1",
    role: "spec" as const,
  },
  runtimePresentation: {
    runtimeKind: "opencode" as const,
    presentToolCall: presentRegularToolCall,
    supportedApprovalReplyOutcomes: null,
  },
});

describe("AgentChatThreadRow", () => {
  test("renders turn duration rows", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...createBaseProps(),
        row: { kind: "turn_duration", key: "duration-1", durationMs: 1200 },
      }),
    );

    expect(html).toContain("1.2s");
  });

  test("renders fork boundary rows with the transcript separator treatment", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...createBaseProps(),
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

  test("renders completed compaction rows as a collapsed separator with its context", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...createBaseProps(),
        row: {
          kind: "compaction",
          key: "compaction-1",
          status: "completed",
          label: "Compacted",
          context: "## Summary\n\nThe task store is the source of truth.",
        },
      }),
    );

    expect(html).toContain("Compacted");
    expect(html).toContain("lucide-shrink");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("The task store is the source of truth.");
    expect(html).not.toContain("animate-spin");
  });

  test("renders a compaction status without a disclosure when no context exists", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...createBaseProps(),
        row: {
          kind: "compaction",
          key: "compaction-1",
          status: "completed",
          label: "Not enough messages to compact.",
          context: null,
        },
      }),
    );

    expect(html).toContain("Not enough messages to compact.");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("lucide-chevron-down");
  });

  test("renders running compaction rows with a loader and no disclosure", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...createBaseProps(),
        row: {
          kind: "compaction",
          key: "compaction-1",
          status: "running",
          label: "Session compaction started.",
          context: null,
        },
      }),
    );

    expect(html).toContain("Compacting…");
    expect(html).toContain("lucide-loader-circle");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("lucide-shrink");
  });

  test("renders message rows", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThreadRow, {
        ...createBaseProps(),
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
    const row: AgentChatTranscriptRow = {
      // @ts-expect-error -- This case verifies the runtime exhaustiveness guard for unknown row kinds.
      kind: "unexpected",
      key: "broken",
    };
    const render = () =>
      renderToStaticMarkup(
        createElement(AgentChatThreadRow, {
          ...createBaseProps(),
          row,
        }),
      );

    expect(render).toThrow("Unhandled agent chat row");
  });
});
