import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { SubagentTranscriptButton } from "./subagent-transcript-button";
import { extractSubagentSessionId } from "./tool-summary";

const createToolMeta = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "subtask",
  status: "completed",
  metadata: {
    sessionId: "session-child-1",
  },
  ...overrides,
});

describe("SubagentTranscriptButton", () => {
  test("extracts only subagent-related session ids", () => {
    expect(extractSubagentSessionId(createToolMeta())).toBe("session-child-1");
    expect(
      extractSubagentSessionId(
        createToolMeta({
          tool: "read",
        }),
      ),
    ).toBeNull();
    expect(
      extractSubagentSessionId(
        createToolMeta({
          metadata: {},
        }),
      ),
    ).toBeNull();
  });

  test("opens a read-only transcript request for supported subagent tool calls", () => {
    const onOpenTranscript = mock(() => {});

    render(
      <SubagentTranscriptButton
        taskId="task-1"
        meta={createToolMeta()}
        onOpenTranscript={onOpenTranscript}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View subagent transcript" }));

    expect(onOpenTranscript).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-child-1",
      title: "Subagent transcript",
      description: "Read-only transcript for subagent session session-child-1.",
    });
  });

  test("does not render when task id or subagent session id is unavailable", () => {
    const { rerender } = render(
      <SubagentTranscriptButton
        taskId={null}
        meta={createToolMeta()}
        onOpenTranscript={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "View subagent transcript" })).toBeNull();

    rerender(
      <SubagentTranscriptButton
        taskId="task-1"
        meta={createToolMeta({ tool: "read" })}
        onOpenTranscript={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "View subagent transcript" })).toBeNull();
  });

  test("prevents parent summary clicks when opening the transcript", () => {
    const onOpenTranscript = mock(() => {});
    const onParentClick = mock(() => {});
    document.body.addEventListener("click", onParentClick);

    try {
      render(
        <SubagentTranscriptButton
          taskId="task-1"
          meta={createToolMeta()}
          onOpenTranscript={onOpenTranscript}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "View subagent transcript" }));

      expect(onOpenTranscript).toHaveBeenCalledTimes(1);
      expect(onParentClick).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener("click", onParentClick);
    }
  });
});
