import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import {
  createClaudeCanUseTool,
  createClaudePermissionTestSession as createSession,
} from "./claude-agent-sdk-permissions.test-support";

describe("createClaudeCanUseTool", () => {
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

    const resultPromise = canUseTool(
      "Bash",
      { command: "git status" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-use-1",
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

    session.pendingApprovals.get("request-1")?.resolve({ behavior: "allow" });
    await expect(resultPromise).resolves.toMatchObject({ behavior: "allow" });
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
        signal: new AbortController().signal,
        toolUseID: "question-child-1",
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

    session.pendingQuestions.get("request-1")?.resolve([["Direct"]]);
    await expect(resultPromise).resolves.toMatchObject({ behavior: "allow" });
  });
});
