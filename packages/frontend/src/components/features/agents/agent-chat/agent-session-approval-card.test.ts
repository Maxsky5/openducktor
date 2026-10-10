import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSessionApprovalCard } from "./agent-session-approval-card";
import { resolveApprovalReplyOutcomes } from "./agent-session-approval-card-model";

const approvalRequest = {
  requestId: "approval-1",
  requestType: "runtime_tool" as const,
  title: "Approve runtime tool",
  affectedPaths: ["src/app.ts", "docs/spec.md"],
  supportedReplyOutcomes: ["approve_once" as const, "approve_turn" as const, "reject" as const],
};

describe("resolveApprovalReplyOutcomes", () => {
  test("intersects request outcomes with runtime descriptor outcomes", () => {
    expect(
      resolveApprovalReplyOutcomes({
        requestSupportedReplyOutcomes: ["approve_once", "approve_turn", "reject"],
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
      }),
    ).toEqual(["approve_once", "reject"]);
  });

  test("uses runtime outcomes when request outcomes are omitted", () => {
    expect(
      resolveApprovalReplyOutcomes({
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
      }),
    ).toEqual(["approve_once", "approve_session", "reject"]);
  });

  test("disables approval replies when runtime capabilities are unavailable", () => {
    expect(
      resolveApprovalReplyOutcomes({
        requestSupportedReplyOutcomes: ["approve_once", "reject"],
        runtimeSupportedReplyOutcomes: null,
      }),
    ).toEqual([]);
  });
});

describe("AgentSessionApprovalCard", () => {
  test("shows lasting project scope and saved rules before sending always", async () => {
    const onReply = mock(async () => {});
    const view = render(
      createElement(AgentSessionApprovalCard, {
        request: {
          ...approvalRequest,
          supportedReplyOutcomes: ["approve_once", "approve_always", "reject"],
          persistentGrant: {
            scope: "project",
            projectDirectory: "/repo",
            rules: [{ action: "shell", resource: "git status*" }],
          },
          rejectsAllPendingApprovals: true,
        },
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_always", "reject"],
        onReply,
      }),
    );
    try {
      expect(view.getByText(/future sessions in/).textContent).toContain("/repo");
      expect(view.getByText("shell: git status*")).toBeTruthy();
      expect(
        view.getByText("Reject cancels all pending approvals in this conversation."),
      ).toBeTruthy();
      expect(onReply).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Allow for project" }));
      });
      expect(onReply).toHaveBeenCalledWith("approval-1", "approve_always");
    } finally {
      view.unmount();
    }
  });

  test("collapse keeps feedback visible and preserves reply availability", async () => {
    const onReply = mock(async () => {});
    const props = {
      request: approvalRequest,
      runtimeSupportedReplyOutcomes: null,
      errorMessage: "Retry approval",
      disabled: true,
      isSubmitting: true,
      onReply,
    };
    const view = render(createElement(AgentSessionApprovalCard, props));
    try {
      await act(async () => {
        fireEvent.click(view.getByText("Approval required"));
      });
      expect(
        view.getByRole("button", { name: "Expand permission request" }).hasAttribute("disabled"),
      ).toBe(false);
      expect(view.getByText("Retry approval")).toBeTruthy();
      expect(view.getByText(/Runtime approval capabilities are unavailable/)).toBeTruthy();
      expect(view.getByText("Submitting approval choice…")).toBeTruthy();
      expect(view.getByText("Affected paths:").closest("[hidden]")).not.toBeNull();
      expect(onReply).not.toHaveBeenCalled();
      await act(async () => {
        view.rerender(
          createElement(AgentSessionApprovalCard, {
            ...props,
            runtimeSupportedReplyOutcomes: ["approve_once", "reject"],
          }),
        );
      });
      expect(view.queryByRole("button", { name: "Approve once" })).toBeNull();
      await act(async () => {
        fireEvent.click(view.getByText("Action required"));
      });
      expect(view.getByRole("button", { name: "Approve once" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(onReply).not.toHaveBeenCalled();
      await act(async () => {
        view.rerender(
          createElement(AgentSessionApprovalCard, {
            ...props,
            runtimeSupportedReplyOutcomes: ["approve_once", "reject"],
            disabled: false,
            isSubmitting: false,
          }),
        );
      });
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Approve once" }));
      });
      expect(onReply).toHaveBeenCalledTimes(1);
      expect(onReply).toHaveBeenCalledWith("approval-1", "approve_once");
    } finally {
      view.unmount();
    }
  });

  test("renders only outcomes supported by the active runtime", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: approvalRequest,
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
        onReply: async () => {},
      }),
    );

    expect(html).toContain("Approve once");
    expect(html).toContain("Reject");
    expect(html).not.toContain("Approve for turn");
  });

  test("renders persistent approval outcomes advertised by the request and runtime", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: {
          ...approvalRequest,
          supportedReplyOutcomes: ["approve_once", "approve_session", "approve_always", "reject"],
        },
        runtimeSupportedReplyOutcomes: [
          "approve_once",
          "approve_session",
          "approve_always",
          "reject",
        ],
        onReply: async () => {},
      }),
    );

    expect(html).toContain("Approve once");
    expect(html).toContain("Approve for session");
    expect(html).toContain("Always allow");
    expect(html).toContain("Reject");
  });

  test("renders affected paths in a scrollable code list", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: approvalRequest,
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
        onReply: async () => {},
      }),
    );

    expect(html).toContain("Affected paths:");
    expect(html).toContain("max-h-24 overflow-auto rounded-md border border-border bg-muted p-2");
    expect(html).toContain(
      '<code class="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">src/app.ts</code>',
    );
    expect(html).toContain(
      '<code class="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">docs/spec.md</code>',
    );
  });

  test("renders non-command tool input for approval context", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: {
          ...approvalRequest,
          requestType: "file_change" as const,
          title: "Approve edit",
          tool: {
            name: "Edit",
            input: {
              file_path: "apps/api/src/lib/auth.ts",
              old_string: "socialProviders: {",
              new_string: "socialProviders: { facebook: {} }",
            },
          },
        },
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
        onReply: async () => {},
      }),
    );

    expect(html).toContain("Tool input:");
    expect(html).toContain("apps/api/src/lib/auth.ts");
    expect(html).toContain("socialProviders");
    expect(html).toContain("max-h-40 overflow-auto");
  });

  test("does not duplicate command tool input when command details are already rendered", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: {
          ...approvalRequest,
          requestType: "command_execution" as const,
          title: "Approve command",
          command: {
            command: "grep -rn facebook apps/api/src/lib/auth.ts",
            workingDirectory: "/workspace",
          },
          tool: {
            name: "Bash",
            input: {
              command: "grep -rn facebook apps/api/src/lib/auth.ts",
            },
          },
        },
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
        onReply: async () => {},
      }),
    );

    expect(html).toContain("Command: grep -rn facebook apps/api/src/lib/auth.ts");
    expect(html).not.toContain("Tool input:");
  });

  test("labels subagent approval requests", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: {
          ...approvalRequest,
          source: {
            kind: "subagent",
            parentExternalSessionId: "parent-session",
            childExternalSessionId: "child-session",
          },
        },
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
        onReply: async () => {},
      }),
    );

    expect(html).toContain("Subagent request");
  });

  test("keeps reply controls disabled when runtime capabilities are unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: approvalRequest,
        runtimeSupportedReplyOutcomes: null,
        onReply: async () => {},
      }),
    );

    expect(html).not.toContain("Approve once");
    expect(html).not.toContain("Reject");
    expect(html).toContain("Runtime approval capabilities are unavailable for this request.");
    expect(html).toContain("Refresh runtime checks or open the session again, then try again.");
  });
});
