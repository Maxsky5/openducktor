import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { fireEvent, render, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMessageCardElement } from "./agent-chat-message-card-test-harness";
import { WorkflowToolMessage } from "./agent-chat-workflow-tool-message";

enableReactActEnvironment();

const TIMESTAMP = "2026-11-06T21:09:18.000Z";

const PULL_REQUEST = {
  providerId: "github",
  number: 141,
  url: "https://github.com/acme/fairnest/pull/141",
  state: "open",
  createdAt: "2026-11-06T21:09:17Z",
  updatedAt: "2026-11-06T21:09:17Z",
};

const renderToolCard = (meta: ToolMeta) =>
  render(
    createMessageCardElement({
      message: {
        id: `message-${meta.callId}`,
        role: "tool",
        content: `Tool ${meta.tool} ${meta.status}`,
        timestamp: TIMESTAMP,
        meta,
      },
    }),
  );

const header = (container: HTMLElement): HTMLElement => {
  const title = container.querySelector("button[aria-expanded], p");
  const row = title?.parentElement;
  if (!row) throw new Error("Expected the header of the tool card.");
  return row;
};

describe("WorkflowToolMessage", () => {
  test("titles a Workflow Event call with its event and shows only its header while closed", () => {
    const view = renderToolCard({
      kind: "tool",
      partId: "part-event",
      callId: "call-event",
      tool: "openducktor_odt_apply_workflow_event",
      toolType: "workflow",
      status: "completed",
      input: { taskId: "task-1", eventId: "build-completed", note: "Facebook login works." },
      output: '{"ok":true}',
    });
    try {
      const title = view.getByRole("button", { name: "Build Completed details" });
      expect(title.textContent).toBe("Build Completed");
      expect(view.container.querySelector(".lucide-workflow")).not.toBeNull();
      expect(view.queryByText("Workflow Event")).toBeNull();
      expect(view.queryByText("build-completed")).toBeNull();
      expect(view.queryByText(/Facebook login works/)).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows the note as Markdown before the Input and Output boxes when the card opens", async () => {
    const view = renderToolCard({
      kind: "tool",
      partId: "part-note",
      callId: "call-note",
      tool: "odt_apply_workflow_event",
      toolType: "workflow",
      status: "completed",
      input: {
        taskId: "task-1",
        eventId: "build-completed",
        note: "What changed:\n\n- Facebook **login** works.",
      },
      output: '{"ok":true}',
    });
    try {
      fireEvent.click(view.getByRole("button", { name: "Build Completed details" }));
      const item = await view.findByText(/Facebook/, { selector: "li" });
      expect(item.querySelector("strong")?.textContent).toBe("login");
      expect(view.queryByText(/- Facebook/)).toBeNull();
      const input = view.getByText("Input");
      expect(item.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  test("keeps the Workflow Event title until the input has an event", () => {
    const view = renderToolCard({
      kind: "tool",
      partId: "part-event-pending",
      callId: "call-event-pending",
      tool: "odt_apply_workflow_event",
      toolType: "workflow",
      status: "pending",
      inputStreaming: true,
    });
    try {
      expect(view.getByText("Workflow Event")).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  test("titles a set_pull_request call and links its saved pull request", () => {
    const view = renderToolCard({
      kind: "tool",
      partId: "part-pr",
      callId: "call-pr",
      tool: "odt_set_pull_request",
      toolType: "workflow",
      status: "completed",
      title: "task-1 · #141",
      input: { taskId: "task-1", number: 141 },
      output: JSON.stringify({ task: { id: "task-1" }, pullRequest: PULL_REQUEST }),
    });
    try {
      const row = header(view.container);
      expect(within(row).getByText("Set Pull Request")).toBeTruthy();
      expect(view.queryByText("set_pull_request")).toBeNull();
      expect(within(row).getByRole("button", { name: "PR #141" })).toBeTruthy();
      expect(view.container.querySelector(".lucide-git-pull-request")).not.toBeNull();
      expect(view.queryByText("task-1 · #141")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows no pull request link when the output has no pull request URL", () => {
    const { url: _url, ...withoutUrl } = PULL_REQUEST;
    const view = renderToolCard({
      kind: "tool",
      partId: "part-pr-no-url",
      callId: "call-pr-no-url",
      tool: "odt_set_pull_request",
      toolType: "workflow",
      status: "completed",
      input: { taskId: "task-1", number: 141 },
      output: JSON.stringify({ pullRequest: withoutUrl }),
    });
    try {
      expect(view.getByText("Set Pull Request")).toBeTruthy();
      expect(view.queryByRole("button", { name: "PR #141" })).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows the Input and Output boxes only after a press on the tool name", () => {
    const view = render(
      <WorkflowToolMessage
        meta={{
          kind: "tool",
          partId: "part-io",
          callId: "call-io",
          tool: "odt_set_pull_request",
          toolType: "workflow",
          status: "completed",
          input: { taskId: "task-1", number: 141 },
          output: '{"ok":true}',
        }}
        odtTool="odt_set_pull_request"
        messageTimestamp={TIMESTAMP}
        timeLabel=""
        displayName="Set Pull Request"
      />,
    );
    try {
      const title = view.getByRole("button", { name: "Set Pull Request details" });
      expect(title.getAttribute("aria-expanded")).toBe("false");
      expect(view.queryByText("Input")).toBeNull();
      expect(view.queryByText("Output")).toBeNull();

      fireEvent.click(title);
      expect(title.getAttribute("aria-expanded")).toBe("true");
      expect(view.getByText("Input")).toBeTruthy();
      expect(view.getByText("Output")).toBeTruthy();

      fireEvent.click(title);
      expect(title.getAttribute("aria-expanded")).toBe("false");
      expect(view.queryByText("Input")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows a plain error text as the line of a failed call, with no Error box", () => {
    const view = render(
      <WorkflowToolMessage
        meta={{
          kind: "tool",
          partId: "part-error",
          callId: "call-error",
          tool: "odt_apply_workflow_event",
          toolType: "workflow",
          status: "error",
          input: { taskId: "task-1", eventId: "build-blocked" },
          error: "build-blocked requires a note.",
        }}
        odtTool="odt_apply_workflow_event"
        messageTimestamp={TIMESTAMP}
        timeLabel=""
        displayName="Workflow Event"
      />,
    );
    try {
      expect(view.getByText("build-blocked requires a note.").tagName).toBe("P");
      expect(view.getByText("FAILED")).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "Build Blocked details" }));
      expect(view.getByText("Input")).toBeTruthy();
      expect(view.queryByText("Error")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows the message of an ODT error, and its JSON in a closed Error box after a press", () => {
    const envelope = JSON.stringify(
      {
        ok: false,
        error: {
          code: "ODT_HOST_BRIDGE_ERROR",
          message: "Task task-1 already has pull request #141.",
          details: { taskId: "task-1" },
        },
      },
      null,
      2,
    );
    const view = render(
      <WorkflowToolMessage
        meta={{
          kind: "tool",
          partId: "part-envelope",
          callId: "call-envelope",
          tool: "odt_set_pull_request",
          toolType: "workflow",
          status: "error",
          input: { taskId: "task-1", number: 143 },
          error: envelope,
        }}
        odtTool="odt_set_pull_request"
        messageTimestamp={TIMESTAMP}
        timeLabel=""
        displayName="Set Pull Request"
        summary="Task task-1 already has pull request #141."
      />,
    );
    try {
      expect(view.getAllByText("Task task-1 already has pull request #141.")).toHaveLength(1);
      expect(view.container.textContent).not.toContain("ODT_HOST_BRIDGE_ERROR");
      expect(view.queryByText("Error")).toBeNull();

      fireEvent.click(view.getByRole("button", { name: "Set Pull Request details" }));
      const error = view.getByText("Error").closest("details");
      expect(error?.open).toBe(false);
      expect(error?.textContent).toContain("ODT_HOST_BRIDGE_ERROR");
    } finally {
      view.unmount();
    }
  });

  test("shows the JSON of an ODT error that only the output holds once, in a closed Error box", () => {
    const envelope = JSON.stringify({
      ok: false,
      error: { code: "ODT_HOST_BRIDGE_ERROR", message: "Pull request #143 was not found." },
    });
    const view = renderToolCard({
      kind: "tool",
      partId: "part-output-error",
      callId: "call-output-error",
      tool: "mcp__openducktor__odt_set_pull_request",
      toolType: "workflow",
      status: "error",
      input: { taskId: "task-1", number: 143 },
      output: envelope,
    });
    try {
      expect(view.getAllByText("Pull request #143 was not found.")).toHaveLength(1);
      fireEvent.click(view.getByRole("button", { name: "Set Pull Request details" }));
      expect(view.queryByText("Output")).toBeNull();
      const error = view.getByText("Error").closest("details");
      expect(error?.open).toBe(false);
      expect(error?.textContent).toContain("ODT_HOST_BRIDGE_ERROR");
    } finally {
      view.unmount();
    }
  });
  test("uses runtime part timing for workflow duration display", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "workflow",
            status: "completed",
            input: { taskId: "fairnest-abc", markdown: "# Spec" },
            output: "ok",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
            inputReadyAtMs: Date.parse("2026-02-20T19:00:30.000Z"),
            observedStartedAtMs: Date.parse("2026-02-20T19:00:00.000Z"),
            observedEndedAtMs: Date.parse("2026-02-20T19:01:00.000Z"),
          },
        },
      }),
    );

    expect(html).toContain("1.5s");
    expect(html).not.toContain("30s");
  });

  test("falls back to part timing when observed timing is absent", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "workflow",
            status: "completed",
            input: { taskId: "fairnest-def", markdown: "# Spec" },
            output: "ok",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
          },
        },
      }),
    );

    expect(html).toContain("1.5s");
  });

  test("renders failed workflow tool pill aligned cleanly without centered ml-auto", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-failed",
          role: "tool",
          content: "Tool openducktor_odt_set_pull_request failed",
          timestamp: "2026-02-20T19:00:02.500Z",
          meta: {
            kind: "tool",
            partId: "part-failed",
            callId: "call-failed",
            tool: "openducktor_odt_set_pull_request",
            toolType: "workflow",
            status: "error",
            input: { taskId: "fairnest-def" },
            error: "Branch conflict",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
          },
        },
      }),
    );

    expect(html).toContain("FAILED");
    expect(html).not.toContain("ml-auto rounded-full");
    expect(html).toContain("rounded-full border");
    expect(html).toContain("1.5s");
    expect(html).not.toMatch(/<details\b[^>]*\bopen\b/);
    expect(html).not.toContain(">Activity<");
  });

  test("shows the error message of a failed ODT tool and keeps its error JSON closed", () => {
    const envelope = JSON.stringify(
      {
        ok: false,
        error: {
          code: "ODT_HOST_BRIDGE_ERROR",
          message: "Task task-x already has pull request #141.",
          details: { taskId: "task-x" },
        },
      },
      null,
      2,
    );
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-wf-failed",
          role: "tool",
          content: "Tool openducktor_odt_set_pull_request failed",
          timestamp: "2026-02-22T10:20:36.000Z",
          meta: {
            kind: "tool",
            partId: "part-wf-failed",
            callId: "call-wf-failed",
            tool: "openducktor_odt_set_pull_request",
            toolType: "workflow",
            status: "error",
            input: { taskId: "task-x", number: 143 },
            error: envelope,
          },
        },
      }),
    );

    expect(html).toContain(">Task task-x already has pull request #141.</p>");
    expect(html).not.toContain("ODT_HOST_BRIDGE_ERROR");
    expect(html).not.toContain("&quot;ok&quot;");
    expect(html).not.toMatch(/<details\b[^>]*\bopen\b/);
    expect(html).toContain("FAILED");
  });

  test("renders workflow tool executing state with blue styling and running label", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-4",
          role: "tool",
          content: "Tool openducktor_odt_apply_workflow_event running",
          timestamp: "2026-02-22T10:21:00.000Z",
          meta: {
            kind: "tool",
            partId: "part-4",
            callId: "call-4",
            tool: "openducktor_odt_apply_workflow_event",
            toolType: "workflow",
            status: "pending",
            input: {
              taskId: "fairnest-98a",
              eventId: "build-blocked",
              note: "The API key is missing.",
            },
            output: "",
          },
        },
      }),
    );

    expect(html).toContain(">Build Blocked</span>");
    expect(html).not.toContain("The API key is missing.");
    expect(html).not.toContain("build-blocked");
    expect(html).toContain('aria-label="Running tool"');
    expect(html).toContain("border-info-border");
    expect(html).not.toContain("border-pending-border");
    expect(html).toContain("RUNNING");
    expect(html).not.toContain("Workflow Event");
    expect(html).toContain("lucide-workflow");
  });

  test("shows progress while the model prepares workflow tool arguments", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-preparing",
          role: "tool",
          content: "Tool openducktor_odt_set_plan pending",
          timestamp: "2026-02-22T10:21:10.000Z",
          meta: {
            kind: "tool",
            partId: "part-preparing",
            callId: "call-preparing",
            tool: "openducktor_odt_set_plan",
            toolType: "workflow",
            status: "pending",
            inputStreaming: true,
          },
        },
      }),
    );

    expect(html).toContain("PREPARING");
    expect(html).toContain('aria-label="Preparing tool"');
    expect(html).toContain("border-info-border");
    expect(html).not.toContain("QUEUED");
    expect(html).not.toContain("RUNNING");
  });

  test("renders pending workflow tools as preparing with completed arguments", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-queued",
          role: "tool",
          content: "Tool openducktor_odt_set_plan pending",
          timestamp: "2026-02-22T10:21:10.000Z",
          meta: {
            kind: "tool",
            partId: "part-queued",
            callId: "call-queued",
            tool: "openducktor_odt_set_plan",
            toolType: "workflow",
            status: "pending",
            inputStreaming: false,
            input: { taskId: "fairnest-98a" },
            output: "",
          },
        },
      }),
    );

    expect(html).not.toContain('aria-label="Preparing tool"');
    expect(html).not.toContain('aria-label="Running tool"');
    expect(html).toContain("border-pending-border");
    expect(html).not.toContain("border-info-border");
    expect(html).toContain("PREPARING");
    expect(html).not.toContain("QUEUED");
    expect(html).not.toContain("RUNNING");
  });

  test("renders workflow MCP validation failures as destructive error details", () => {
    const validationError =
      'MCP error -32602: Input validation error: Invalid arguments for tool odt_set_pull_request: [{"path":["workspaceId"],"message":"Invalid input: expected never, received string"}]';
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-5",
          role: "tool",
          content: "Tool odt_set_pull_request failed",
          timestamp: "2026-02-22T10:21:30.000Z",
          meta: {
            kind: "tool",
            partId: "part-5",
            callId: "call-5",
            tool: "odt_set_pull_request",
            toolType: "workflow",
            status: "error",
            input: {
              taskId: "fairnest-99z",
              workspaceId: "repo",
              providerId: "github",
              number: 12,
            },
            error: validationError,
          },
        },
      }),
    );

    expect(html).toContain("border-destructive-border");
    expect(html).not.toContain("border-success-border");
    expect(html).not.toContain("border-cancelled-border");
    expect(html).toContain("FAILED");
    expect(html).toContain("odt_set_pull_request");
    expect(html).toContain("workspaceId");
    expect(html).toContain("Input validation error");
  });

  test("renders workflow status-guard rejections as error styling", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-guard",
          role: "tool",
          content: "Tool odt_set_spec completed",
          timestamp: "2026-02-22T10:21:35.000Z",
          meta: {
            kind: "tool",
            partId: "part-guard",
            callId: "call-guard",
            tool: "odt_set_spec",
            toolType: "workflow",
            status: "error",
            input: { taskId: "fairnest-99z" },
            error:
              "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: closed)",
          },
        },
      }),
    );

    expect(html).toContain("border-destructive-border");
    expect(html).not.toContain("border-success-border");
  });

  test("renders cancelled workflow tools with orange styling", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-cancelled",
          role: "tool",
          content: "Tool odt_set_plan failed",
          timestamp: "2026-02-22T10:21:40.000Z",
          meta: {
            kind: "tool",
            partId: "part-cancelled",
            callId: "call-cancelled",
            tool: "odt_set_plan",
            toolType: "workflow",
            status: "error",
            input: { taskId: "fairnest-cancelled" },
            error: "Request cancelled by user",
            output: "",
          },
        },
      }),
    );

    expect(html).toContain("border-cancelled-border");
    expect(html).not.toContain("border-destructive-border");
  });
});
