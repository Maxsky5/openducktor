import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import type { McpTaskArtifact, RuntimeKind } from "@openducktor/contracts";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { ChatArtifactLinkContext } from "./agent-chat-artifact-link-context";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";

enableReactActEnvironment();

const freeArtifact: McpTaskArtifact = {
  classification: "free",
  taskId: "task-1",
  code: "login-preview",
  name: "Login preview",
  fileName: "login.html",
  mediaType: "text/html",
  byteSize: 42,
  revision: 2,
  updatedAt: "2026-10-23T12:00:00.000Z",
};

const card = (
  input: ToolMeta["input"],
  artifact: McpTaskArtifact | null,
  overrides: Partial<ToolMeta> = {},
  runtimeKind: RuntimeKind = "codex",
) => {
  const tool =
    runtimeKind === "claude"
      ? "mcp__openducktor__odt_set_task_artifact"
      : runtimeKind === "opencode"
        ? "functions.openducktor_odt_set_task_artifact"
        : "odt_set_task_artifact";
  const meta: ToolMeta = {
    kind: "tool",
    partId: "part-1",
    callId: "call-1",
    tool,
    displayLabel: tool,
    toolType: "workflow",
    status: "completed",
    ...overrides,
  };
  if (input) meta.input = input;
  if (artifact && overrides.output === undefined) meta.output = JSON.stringify({ artifact });
  const message: AgentChatMessage = {
    id: "artifact-write",
    role: "tool",
    content: "Tool completed",
    timestamp: "2026-10-23T12:00:00.000Z",
    meta,
  };
  return (
    <AgentChatMessageCard
      message={message}
      sessionIdentity={null}
      runtimePresentation={resolveAgentChatRuntimePresentation({
        runtimeDefinitions: [],
        runtimeKind,
      })}
    />
  );
};

describe("artifact tool cards", () => {
  test.each([
    ["spec", undefined, "Set Spec", "codex"],
    ["plan", undefined, "Set Plan", "claude"],
    ["qaReport", "approved", "Approve QA", "opencode"],
    ["qaReport", "rejected", "Reject QA", "codex"],
  ] as const)("shows %s with verdict %s as %s in %s", (code, verdict, title, runtimeKind) => {
    const artifact: McpTaskArtifact = {
      taskId: "task-1",
      code,
      name: "Workflow artifact",
      classification: "workflow",
      mediaType: "text/markdown",
      revision: 1,
      updatedAt: "2026-10-23T12:00:00.000Z",
      verdict,
    };
    const view = render(card({ taskId: "task-1", code }, artifact, {}, runtimeKind));
    expect(view.getByText(title)).toBeTruthy();
    expect(view.container.textContent).not.toContain("set_task_artifact");
    expect(view.queryByRole("button", { name: /^Open / })).toBeNull();
  });

  test("shows the saved free name and opens that code once while a read is pending", async () => {
    let finish: (() => void) | undefined;
    const open = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <ChatArtifactLinkContext value={open}>
        {card({ taskId: "task-1", code: freeArtifact.code, name: "Old name" }, freeArtifact)}
      </ChatArtifactLinkContext>,
    );
    expect(view.getByText("Set Artifact · Login preview")).toBeTruthy();
    const button = view.getByRole("button", { name: "Open Login preview" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ taskId: "task-1", code: "login-preview" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(view.getByText("Opening…")).toBeTruthy();
    await act(async () => {
      finish?.();
    });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  test("shows an open error and lets the user try again", async () => {
    const open = mock(async () => {
      throw new Error("This artifact is no longer available.");
    });
    const view = render(
      <ChatArtifactLinkContext value={open}>
        {card(undefined, freeArtifact)}
      </ChatArtifactLinkContext>,
    );
    const button = view.getByRole("button", { name: "Open Login preview" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(view.getByRole("alert").textContent).toBe("This artifact is no longer available.");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  test("shows the task and code on a delete card without a saved-artifact action", () => {
    const view = render(
      card({ taskId: "task-1", code: "login-preview" }, null, {
        tool: "odt_delete_task_artifact",
        preview: "Old artifact preview",
        output: '{"taskId":"task-1","code":"login-preview","deleted":true}',
      }),
    );
    expect(view.getByText("Delete Artifact")).toBeTruthy();
    expect(view.getByText("task-1 · login-preview")).toBeTruthy();
    expect(view.queryByText("Old artifact preview")).toBeNull();
    expect(view.queryByRole("button", { name: /^Open / })).toBeNull();
  });

  test.each([
    { status: "running" as const },
    { status: "error" as const, error: "Write failed" },
    { status: "error" as const, error: "Tool cancelled" },
    { output: "malformed result" },
  ])("does not offer Open for an unsaved artifact: %j", (overrides) => {
    const view = render(
      <ChatArtifactLinkContext value={mock(async () => {})}>
        {card({ name: "Login preview", code: freeArtifact.code }, freeArtifact, overrides)}
      </ChatArtifactLinkContext>,
    );
    expect(view.queryByRole("button", { name: /^Open / })).toBeNull();
  });

  test("does not call a failed QA approval successful", () => {
    const view = render(
      card({ code: "qaReport", verdict: "approved" }, null, {
        status: "error",
        error: "Save failed",
      }),
    );
    expect(view.getByText("Approve QA")).toBeTruthy();
    expect(view.queryByText("QA approved")).toBeNull();
    expect(view.getByText("FAILED")).toBeTruthy();
  });
});
