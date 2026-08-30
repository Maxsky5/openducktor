import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { claudeSubagentEventSession } from "./claude-agent-sdk-event-session";
import {
  createClaudeCanUseTool,
  createClaudeRepositoryPermissionTestSession,
  createClaudePermissionTestSession as createSession,
} from "./claude-agent-sdk-permissions.test-support";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";

const addNestedSubagent = (session: ClaudeSessionContext): void => {
  session.subagentAgentIdsByToolUseId = new Map([["outer-agent-tool", "outer-agent"]]);
  const outerSession = claudeSubagentEventSession(session, "outer-agent-tool");
  if (!outerSession) {
    throw new Error("Expected outer Claude subagent session.");
  }
  outerSession.subagentAgentIdsByToolUseId = new Map([["nested-agent-tool", "nested-agent"]]);
};

describe("createClaudeCanUseTool", () => {
  test("rejects non-JSON tool input before publishing an approval", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    await expect(
      canUseTool(
        "Bash",
        { command: new Date() },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-use-1",
          requestId: "sdk-request-1",
        },
      ),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "claudeToolInput",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("requests approval for repository task creation as a mutating runtime tool", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeRepositoryPermissionTestSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "mcp__openducktor__odt_create_task",
      { title: "New task" },
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
        requestType: "runtime_tool",
        mutation: "mutating",
        tool: {
          name: "mcp__openducktor__odt_create_task",
          input: { title: "New task" },
        },
      }),
    ]);
    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });
    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { title: "New task" },
    });
  });

  test("auto-allows repository task search as a read-only runtime tool", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeRepositoryPermissionTestSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    await expect(
      canUseTool(
        "mcp__openducktor__odt_search_tasks",
        { query: "repository chat" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-use-1",
          requestId: "sdk-request-1",
        },
      ),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { query: "repository chat" },
    });
    expect(events).toEqual([]);
  });

  test("allows native Claude ODT read tool aliases for workflow roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "mcp__openducktor__odt_read_task",
      { taskId: "task-1" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        requestId: "sdk-request-1",
      },
    );

    expect(result).toEqual({
      behavior: "allow",
      updatedInput: { taskId: "task-1" },
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies native Claude ODT mutation tool aliases outside the role policy", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("spec");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const result = await canUseTool(
      "mcp__openducktor__odt_build_completed",
      { taskId: "task-1" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
        requestId: "sdk-request-1",
      },
    );

    expect(result).toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool odt_build_completed is not allowed for spec sessions.",
    });
    expect(events).toEqual([]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("denies public repository tools in workflow sessions", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    await expect(
      canUseTool(
        "mcp__openducktor__odt_search_tasks",
        { query: "task" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-use-1",
          requestId: "sdk-request-1",
        },
      ),
    ).resolves.toEqual({
      behavior: "deny",
      decisionClassification: "user_reject",
      message: "Tool odt_search_tasks is not allowed for build sessions.",
    });
    expect(events).toEqual([]);
  });

  test("delegates Bash permission decisions for read-only workflow roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Bash",
      { command: "rg Claude packages/host" },
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
        command: {
          command: "rg Claude packages/host",
          workingDirectory: "/repo",
        },
        mutation: "unknown",
      }),
    ]);
    expect(session.pendingApprovals.has("request-1")).toBe(true);

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "rg Claude packages/host" },
    });
  });

  test("requires approval for read-only shell inspection outside the worktree in build roles", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });

    const resultPromise = canUseTool(
      "Bash",
      { command: "cat /etc/passwd" },
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
        command: {
          command: "cat /etc/passwd",
          workingDirectory: "/repo",
        },
        tool: {
          name: "Bash",
          input: { command: "cat /etc/passwd" },
        },
        mutation: "unknown",
      }),
    ]);
    expect(session.pendingApprovals.has("request-1")).toBe(true);

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "cat /etc/passwd" },
    });
  });

  test("publishes subagent approvals only to the child transcript", async () => {
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
      { command: "git status" },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
        requestId: "sdk-request-1",
        agentID: "agent-child-1",
      },
    );

    const childExternalSessionId = "session-1::claude-subagent::agent-child-1";
    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        externalSessionId: childExternalSessionId,
        parentExternalSessionId: "session-1",
        childExternalSessionId,
        subagentCorrelationKey: "agent-child-1",
        requestId: "request-1",
      }),
    ]);
    expect(session.pendingApprovals.get("request-1")?.event).toMatchObject({
      parentExternalSessionId: "session-1",
      childExternalSessionId,
      subagentCorrelationKey: "agent-child-1",
    });

    abortController.abort();
    await expect(resultPromise).resolves.toMatchObject({ behavior: "deny" });
    expect(events[1]).toMatchObject({
      type: "approval_resolved",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId: "session-1",
      childExternalSessionId,
      subagentCorrelationKey: "agent-child-1",
      requestId: "request-1",
    });
  });

  test("publishes subagent questions only to the child transcript", async () => {
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
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which approach should the subagent use?",
            header: "Approach",
            options: [{ label: "Direct", description: "Use the direct approach." }],
            multiSelect: false,
          },
        ],
      },
      {
        signal: abortController.signal,
        toolUseID: "question-child-1",
        requestId: "sdk-request-1",
        agentID: "agent-child-1",
      },
    );

    const childExternalSessionId = "session-1::claude-subagent::agent-child-1";
    expect(events).toEqual([
      expect.objectContaining({
        type: "question_required",
        externalSessionId: childExternalSessionId,
        parentExternalSessionId: "session-1",
        childExternalSessionId,
        subagentCorrelationKey: "agent-child-1",
        requestId: "request-1",
      }),
    ]);

    abortController.abort();
    await expect(resultPromise).resolves.toMatchObject({ behavior: "deny" });
    expect(events[1]).toMatchObject({
      type: "question_resolved",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId: "session-1",
      childExternalSessionId,
      subagentCorrelationKey: "agent-child-1",
      requestId: "request-1",
    });
  });

  test("publishes nested subagent approvals to the nested transcript", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    addNestedSubagent(session);
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const abortController = new AbortController();

    const resultPromise = canUseTool(
      "Bash",
      { command: "git status" },
      {
        signal: abortController.signal,
        toolUseID: "tool-use-1",
        requestId: "sdk-request-1",
        agentID: "nested-agent",
      },
    );

    const parentExternalSessionId = "session-1::claude-subagent::outer-agent";
    const childExternalSessionId = `${parentExternalSessionId}::claude-subagent::nested-agent`;
    expect(events).toEqual([
      expect.objectContaining({
        type: "approval_required",
        externalSessionId: childExternalSessionId,
        parentExternalSessionId,
        childExternalSessionId,
        subagentCorrelationKey: "nested-agent",
        requestId: "request-1",
      }),
    ]);

    abortController.abort();
    await expect(resultPromise).resolves.toMatchObject({ behavior: "deny" });
    expect(events[1]).toMatchObject({
      type: "approval_resolved",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId,
      childExternalSessionId,
      subagentCorrelationKey: "nested-agent",
      requestId: "request-1",
    });
  });

  test("publishes nested subagent questions to the nested transcript", async () => {
    const events: AgentEvent[] = [];
    const session = createSession("build");
    addNestedSubagent(session);
    const canUseTool = createClaudeCanUseTool({
      session,
      now: () => "2026-06-25T12:00:00.000Z",
      randomId: () => "request-1",
      emit: (_session, event) => events.push(event),
    });
    const abortController = new AbortController();

    const resultPromise = canUseTool(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which approach should the nested subagent use?",
            header: "Approach",
            options: [{ label: "Direct", description: "Use the direct approach." }],
            multiSelect: false,
          },
        ],
      },
      {
        signal: abortController.signal,
        toolUseID: "question-nested-1",
        requestId: "sdk-request-1",
        agentID: "nested-agent",
      },
    );

    const parentExternalSessionId = "session-1::claude-subagent::outer-agent";
    const childExternalSessionId = `${parentExternalSessionId}::claude-subagent::nested-agent`;
    expect(events).toEqual([
      expect.objectContaining({
        type: "question_required",
        externalSessionId: childExternalSessionId,
        parentExternalSessionId,
        childExternalSessionId,
        subagentCorrelationKey: "nested-agent",
        requestId: "request-1",
      }),
    ]);

    abortController.abort();
    await expect(resultPromise).resolves.toMatchObject({ behavior: "deny" });
    expect(events[1]).toMatchObject({
      type: "question_resolved",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId,
      childExternalSessionId,
      subagentCorrelationKey: "nested-agent",
      requestId: "request-1",
    });
  });
});
