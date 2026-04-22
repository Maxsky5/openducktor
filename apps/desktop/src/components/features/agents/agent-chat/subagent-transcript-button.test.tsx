import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SubagentMeta } from "./agent-chat-message-card-model.types";
import { SubagentTranscriptButton } from "./subagent-transcript-button";

const createSubagentMeta = (overrides: Partial<SubagentMeta> = {}): SubagentMeta => ({
  kind: "subagent",
  partId: "part-1",
  correlationKey: "session:assistant-1:session-child-1",
  status: "completed",
  agent: "build",
  description: "Did work",
  sessionId: "session-child-1",
  ...overrides,
});

describe("SubagentTranscriptButton", () => {
  test("opens a read-only session view request for subagent cards", () => {
    const onOpenTranscript = mock(() => {});

    render(
      <SubagentTranscriptButton
        taskId="task-1"
        meta={createSubagentMeta()}
        onOpenTranscript={onOpenTranscript}
      />,
    );

    expect(screen.getByRole("button", { name: "View subagent session" }).textContent).toContain(
      "Subagent session",
    );

    fireEvent.click(screen.getByRole("button", { name: "View subagent session" }));

    expect(onOpenTranscript).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-child-1",
      title: "Subagent activity",
      description: "View what this subagent did.",
    });
  });

  test("does not render when task id or subagent session id is unavailable", () => {
    const { rerender } = render(
      <SubagentTranscriptButton
        taskId={null}
        meta={createSubagentMeta()}
        onOpenTranscript={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "View subagent session" })).toBeNull();

    const metaWithoutSessionId = createSubagentMeta();
    delete metaWithoutSessionId.sessionId;

    rerender(
      <SubagentTranscriptButton
        taskId="task-1"
        meta={metaWithoutSessionId}
        onOpenTranscript={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "View subagent session" })).toBeNull();
  });

  test("prevents parent summary clicks when opening the session view", () => {
    const onOpenTranscript = mock(() => {});
    const onParentClick = mock(() => {});
    document.body.addEventListener("click", onParentClick);

    try {
      render(
        <SubagentTranscriptButton
          taskId="task-1"
          meta={createSubagentMeta()}
          onOpenTranscript={onOpenTranscript}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "View subagent session" }));

      expect(onOpenTranscript).toHaveBeenCalledTimes(1);
      expect(onParentClick).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener("click", onParentClick);
    }
  });

  test("renders the transcript action as a labeled outline button", () => {
    render(
      <SubagentTranscriptButton
        taskId="task-1"
        meta={createSubagentMeta()}
        onOpenTranscript={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "View subagent session" });
    expect(button.className).toContain("rounded-md");
    expect(button.className).toContain("h-6");
    expect(button.className).toContain("px-2");
    expect(button.textContent).toContain("Subagent session");
  });
});
