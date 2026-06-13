import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SubagentMeta } from "./agent-chat-message-card-model.types";
import { SubagentTranscriptButton } from "./subagent-transcript-button";

const runtimeKind = "opencode" as const;

const createSubagentMeta = (overrides: Partial<SubagentMeta> = {}): SubagentMeta => ({
  kind: "subagent",
  partId: "part-1",
  correlationKey: "session:assistant-1:session-child-1",
  status: "completed",
  agent: "build",
  description: "Did work",
  externalSessionId: "session-child-1",
  ...overrides,
});

const pendingApproval = {
  requestId: "permission-1",
  requestType: "permission_grant" as const,
  title: `Approve permission: ${"file.read"}`,
  summary: `Approval request for ${"file.read"}.`,
  affectedPaths: ["src/app.ts"],
  action: { name: "file.read" },
  mutation: "read_only" as const,
  supportedReplyOutcomes: ["approve_once" as const, "approve_session" as const, "reject" as const],
};

const pendingQuestion = {
  requestId: "question-1",
  questions: [
    {
      header: "Choose path",
      question: "Which path should the subagent use?",
      options: [{ label: "A", description: "Path A" }],
    },
  ],
};

describe("SubagentTranscriptButton", () => {
  test("opens a read-only session view request for subagent cards", () => {
    const onOpenTranscript = mock(() => {});

    render(
      <SubagentTranscriptButton
        sessionRuntimeKind={runtimeKind}
        sessionWorkingDirectory="/repo-a"
        pendingApprovals={[pendingApproval]}
        pendingQuestions={[pendingQuestion]}
        meta={createSubagentMeta()}
        onOpenTranscript={onOpenTranscript}
      />,
    );

    expect(screen.getByRole("button", { name: "View subagent session" }).textContent).toContain(
      "Subagent session",
    );

    fireEvent.click(screen.getByRole("button", { name: "View subagent session" }));

    expect(onOpenTranscript).toHaveBeenCalledWith({
      externalSessionId: "session-child-1",
      title: "Subagent activity",
      description: "View what this subagent did.",
      source: {
        runtimeKind,
        workingDirectory: "/repo-a",
        pendingApprovals: [pendingApproval],
        pendingQuestions: [pendingQuestion],
      },
    });
  });

  test("marks runtime-backed subagent transcript requests as subagent sessions", () => {
    const onOpenTranscript = mock(() => {});

    render(
      <SubagentTranscriptButton
        sessionRuntimeKind={runtimeKind}
        sessionWorkingDirectory="/repo-a"
        meta={createSubagentMeta()}
        onOpenTranscript={onOpenTranscript}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View subagent session" }));

    expect(onOpenTranscript).toHaveBeenCalledWith({
      externalSessionId: "session-child-1",
      title: "Subagent activity",
      description: "View what this subagent did.",
      source: {
        runtimeKind,
        workingDirectory: "/repo-a",
      },
    });
  });

  test("opens running subagent transcript requests with runtime identity", () => {
    const onOpenTranscript = mock(() => {});

    render(
      <SubagentTranscriptButton
        sessionRuntimeKind={runtimeKind}
        sessionWorkingDirectory="/repo-a"
        meta={createSubagentMeta({ status: "running" })}
        onOpenTranscript={onOpenTranscript}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View subagent session" }));

    expect(onOpenTranscript).toHaveBeenCalledWith({
      externalSessionId: "session-child-1",
      title: "Subagent activity",
      description: "View what this subagent did.",
      source: {
        runtimeKind,
        workingDirectory: "/repo-a",
      },
    });
  });

  test("does not render when subagent session id is unavailable", () => {
    const { rerender } = render(
      <SubagentTranscriptButton
        sessionRuntimeKind={runtimeKind}
        sessionWorkingDirectory="/repo-a"
        meta={createSubagentMeta()}
        onOpenTranscript={() => {}}
      />,
    );

    const metaWithoutSessionId = createSubagentMeta();
    delete metaWithoutSessionId.externalSessionId;

    rerender(
      <SubagentTranscriptButton
        sessionRuntimeKind={runtimeKind}
        sessionWorkingDirectory="/repo-a"
        meta={metaWithoutSessionId}
        onOpenTranscript={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "View subagent session" })).toBeNull();
  });

  test("does not downgrade subagent cards to workflow transcripts when runtime context is unavailable", () => {
    render(<SubagentTranscriptButton meta={createSubagentMeta()} onOpenTranscript={() => {}} />);

    expect(screen.queryByRole("button", { name: "View subagent session" })).toBeNull();
  });

  test("does not render when runtime kind or working directory is unavailable", () => {
    const { rerender } = render(
      <SubagentTranscriptButton
        sessionRuntimeKind={runtimeKind}
        meta={createSubagentMeta()}
        onOpenTranscript={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "View subagent session" })).toBeNull();

    rerender(
      <SubagentTranscriptButton
        sessionWorkingDirectory="/repo-a"
        meta={createSubagentMeta()}
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
          sessionRuntimeKind={runtimeKind}
          sessionWorkingDirectory="/repo-a"
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
        sessionRuntimeKind={runtimeKind}
        sessionWorkingDirectory="/repo-a"
        meta={createSubagentMeta()}
        onOpenTranscript={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "View subagent session" });
    expect(button.className).toContain("shrink-0");
    expect(button.getAttribute("title")).toBe("View subagent session");
    expect(button.textContent).toContain("Subagent session");
  });
});
