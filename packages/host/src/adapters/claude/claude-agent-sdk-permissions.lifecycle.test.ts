import { claudeTestRolePolicy } from "../../test-support/workflow-role-policy";
import { describe, expect, spyOn, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { prepareClaudeApprovalReply } from "./claude-agent-sdk-pending-input";
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
      rolePolicy: claudeTestRolePolicy(session),
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
        requestId: "sdk-request-1",
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
      expect.objectContaining({
        type: "approval_resolved",
        requestId: "request-1",
      }),
    ]);
  });

  test("does not create pending approvals when the Claude permission signal is already aborted", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      rolePolicy: claudeTestRolePolicy(session),
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
        requestId: "sdk-request-1",
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

  test("cleans up pending approvals when approval event publication fails", async () => {
    const session = createSession("build");
    const publicationError = new Error("Claude live-session adapter was released.");
    const canUseTool = createClaudeCanUseTool({
      session,
      rolePolicy: claudeTestRolePolicy(session),
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: () => {
        throw publicationError;
      },
    });
    const abortController = new AbortController();
    const removeEventListener = spyOn(abortController.signal, "removeEventListener");

    const resultPromise = canUseTool(
      "Bash",
      { command: "cat /etc/passwd" },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
        requestId: "sdk-request-1",
      },
    );

    await expect(resultPromise).rejects.toBe(publicationError);
    expect(session.pendingApprovals.size).toBe(0);
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  test("delegates shell path access to Claude permissions for read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("qa");
    const canUseTool = createClaudeCanUseTool({
      session,
      rolePolicy: claudeTestRolePolicy(session),
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Bash",
      { command: "cat ~/.ssh/config" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        requestId: "sdk-request-1",
      },
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        requestId: "request-1",
        requestType: "command_execution",
        mutation: "unknown",
      }),
    ]);
    expect(session.pendingApprovals.has("request-1")).toBe(true);

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "cat ~/.ssh/config" },
    });
  });

  test("denies direct file reads outside the session worktree for read-only roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("planner");
    const canUseTool = createClaudeCanUseTool({
      session,
      rolePolicy: claudeTestRolePolicy(session),
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
        requestId: "sdk-request-1",
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
      rolePolicy: claudeTestRolePolicy(session),
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
        requestId: "sdk-request-1",
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
      rolePolicy: claudeTestRolePolicy(session),
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const toolInput = { prompt: "Inspect the repo" };
    const resultPromise = canUseTool("Agent", toolInput, {
      signal: new AbortController().signal,
      toolUseID: "tool-use-1",
      requestId: "sdk-request-1",
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
      rolePolicy: claudeTestRolePolicy(session),
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
        requestId: "sdk-request-1",
      },
    );
    const searchResult = await canUseTool(
      "WebSearch",
      { query: "repo secret" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-2",
        requestId: "sdk-request-2",
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
    expect(session.toolDenialsByCallId.get("tool-use-1")).toEqual({
      denial: {
        source: "read_only_role",
        reason: "Tool WebFetch is disabled for read-only OpenDucktor workflow roles.",
      },
    });
  });

  test("marks a host reject for the read-only role on the call, but not a user reject", async () => {
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      rolePolicy: claudeTestRolePolicy(session),
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: (() => {
        let next = 0;
        return () => `request-${++next}`;
      })(),
      emit: () => {},
    });
    const ask = (toolUseID: string) =>
      canUseTool(
        "Bash",
        { command: "cat /etc/passwd" },
        { signal: new AbortController().signal, toolUseID, requestId: `sdk-${toolUseID}` },
      );
    const reject = (requestId: string, denialSource?: "read_only_role") =>
      prepareClaudeApprovalReply({
        denialSource,
        input: {
          externalSessionId: session.externalSessionId,
          repoPath: "/repo",
          runtimeKind: "claude",
          runtimePolicy: { kind: "claude" },
          workingDirectory: session.input.workingDirectory,
          requestId,
          outcome: "reject",
          message: "Read-only roles cannot run this command.",
        },
        now: () => "2026-06-25T12:00:01.000Z",
        session,
      }).complete();

    const roleRejected = ask("tool-use-1");
    reject("request-1", "read_only_role");
    const userRejected = ask("tool-use-2");
    reject("request-2");
    await Promise.all([roleRejected, userRejected]);

    expect(session.toolDenialsByCallId.get("tool-use-1")).toEqual({
      denial: { source: "read_only_role", reason: "Read-only roles cannot run this command." },
    });
    expect(session.toolDenialsByCallId.has("tool-use-2")).toBe(false);
  });
});
