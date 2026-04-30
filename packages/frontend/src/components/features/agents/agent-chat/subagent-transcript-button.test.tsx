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
  externalSessionId: "session-child-1",
  ...overrides,
});

const pendingPermission = {
  requestId: "permission-1",
  permission: "file.read",
  patterns: ["src/app.ts"],
};

describe("SubagentTranscriptButton", () => {
  test("opens a read-only session view request for subagent cards", () => {
    const onOpenTranscript = mock(() => {});

    render(
      <SubagentTranscriptButton
        sessionRuntimeKind="opencode"
        sessionRuntimeId="runtime-1"
        sessionWorkingDirectory="/repo-a"
        pendingPermissions={[pendingPermission]}
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
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/repo-a",
        pendingPermissions: [pendingPermission],
      },
    });
  });

  test("marks runtime-backed subagent transcript requests as subagent sessions", () => {
    const onOpenTranscript = mock(() => {});

    render(
      <SubagentTranscriptButton
        sessionRuntimeKind="opencode"
        sessionRuntimeId="runtime-1"
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
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/repo-a",
      },
    });
  });

  test("marks running subagent transcript requests as live", () => {
    const onOpenTranscript = mock(() => {});

    render(
      <SubagentTranscriptButton
        sessionRuntimeKind="opencode"
        sessionRuntimeId="runtime-1"
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
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/repo-a",
        isLive: true,
      },
    });
  });

  test("does not render when subagent session id is unavailable", () => {
    const { rerender } = render(
      <SubagentTranscriptButton
        sessionRuntimeKind="opencode"
        sessionRuntimeId="runtime-1"
        sessionWorkingDirectory="/repo-a"
        meta={createSubagentMeta()}
        onOpenTranscript={() => {}}
      />,
    );

    const metaWithoutSessionId = createSubagentMeta();
    delete metaWithoutSessionId.externalSessionId;

    rerender(
      <SubagentTranscriptButton
        sessionRuntimeKind="opencode"
        sessionRuntimeId="runtime-1"
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

  test("does not render when runtime identity is unavailable", () => {
    render(
      <SubagentTranscriptButton
        sessionRuntimeKind="opencode"
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
          sessionRuntimeKind="opencode"
          sessionRuntimeId="runtime-1"
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
        sessionRuntimeKind="opencode"
        sessionRuntimeId="runtime-1"
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
